import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function useSpeechDictation(onTranscript: (text: string) => void) {
  const [supported] = useState(() => Boolean(getSpeechRecognitionCtor()));
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  const stop = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  const start = (lang: 'en-NG' | 'en-US' = 'en-NG') => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    setError(null);

    try {
      const rec = new Ctor();
      rec.lang = lang;
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.continuous = false;

      rec.onresult = (event: any) => {
        const transcript = event?.results?.[0]?.[0]?.transcript;
        if (typeof transcript === 'string' && transcript.trim()) {
          onTranscriptRef.current(transcript.trim());
        }
      };

      rec.onerror = (event: any) => {
        if (event?.error === 'language-not-supported' && lang === 'en-NG') {
          start('en-US');
          return;
        }
        if (event?.error === 'not-allowed') {
          setError('Microphone permission denied');
        } else if (event?.error !== 'aborted' && event?.error !== 'no-speech') {
          setError('Could not capture speech');
        }
        setListening(false);
      };

      rec.onend = () => {
        setListening(false);
      };

      recognitionRef.current = rec;
      setListening(true);
      rec.start();
    } catch {
      setListening(false);
      setError('Speech dictation unavailable');
    }
  };

  const toggle = () => {
    if (listening) {
      stop();
    } else {
      start('en-NG');
    }
  };

  return { supported, listening, error, toggle, stop };
}

export type VoiceMicStatus = 'idle' | 'listening' | 'unsupported' | 'denied' | 'error';

/**
 * Continuous speech-to-text capture for "Speak your day" (en-NG, fallback en-US).
 * Streams live interim text alongside committed final transcript segments.
 */
export function useContinuousVoiceCapture() {
  const [supported] = useState(() => Boolean(getSpeechRecognitionCtor()));
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<VoiceMicStatus>(() =>
    getSpeechRecognitionCtor() ? 'idle' : 'unsupported'
  );
  const [finalTranscript, setFinalTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [activeLang, setActiveLang] = useState<'en-NG' | 'en-US'>('en-NG');
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    getSpeechRecognitionCtor()
      ? null
      : 'Voice recording is not supported in this browser. You can type your day below or use the manual forms.'
  );

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const manualStopRef = useRef(false);

  useEffect(() => {
    return () => {
      manualStopRef.current = true;
      recognitionRef.current?.abort();
    };
  }, []);

  const stop = () => {
    manualStopRef.current = true;
    recognitionRef.current?.stop();
    setListening(false);
    setInterimTranscript('');
    setStatus((prev) => (prev === 'denied' || prev === 'unsupported' ? prev : 'idle'));
  };

  const start = (lang: 'en-NG' | 'en-US' = 'en-NG') => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setStatus('unsupported');
      setErrorMessage(
        'Voice recording is unavailable in this browser. Type what happened below or use the manual forms.'
      );
      return;
    }

    manualStopRef.current = false;
    setErrorMessage(null);
    setActiveLang(lang);

    try {
      recognitionRef.current?.abort();
    } catch {
      // ignore prior cleanup error
    }

    try {
      const rec = new Ctor();
      rec.lang = lang;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.continuous = true;

      rec.onresult = (event: any) => {
        let addedFinal = '';
        let currentInterim = '';
        const startIdx = typeof event?.resultIndex === 'number' ? event.resultIndex : 0;
        const results = event?.results || [];
        for (let i = startIdx; i < results.length; i++) {
          const res = results[i];
          const text = String(res?.[0]?.transcript || '');
          if (!text) continue;
          if (res.isFinal) {
            addedFinal += (addedFinal ? ' ' : '') + text.trim();
          } else {
            currentInterim += (currentInterim ? ' ' : '') + text.trim();
          }
        }
        if (addedFinal) {
          setFinalTranscript((prev) => (prev.trim() ? `${prev.trim()} ${addedFinal}` : addedFinal));
        }
        setInterimTranscript(currentInterim);
      };

      rec.onerror = (event: any) => {
        const code = String(event?.error || '');
        if ((code === 'language-not-supported' || code === 'service-not-allowed') && lang === 'en-NG') {
          start('en-US');
          return;
        }
        if (code === 'not-allowed' || code === 'permission-denied') {
          manualStopRef.current = true;
          setListening(false);
          setInterimTranscript('');
          setStatus('denied');
          setErrorMessage(
            'Microphone permission was denied. Allow mic access in your browser settings, type your summary below, or use the manual entry forms.'
          );
          return;
        }
        if (code === 'audio-capture') {
          manualStopRef.current = true;
          setListening(false);
          setInterimTranscript('');
          setStatus('error');
          setErrorMessage(
            'No microphone could be accessed on this device. Type what happened below or use manual entry.'
          );
          return;
        }
        if (code !== 'aborted' && code !== 'no-speech') {
          setListening(false);
          setInterimTranscript('');
          setStatus('error');
          setErrorMessage('Could not capture clear speech. You can edit or type your summary below.');
        }
      };

      rec.onend = () => {
        setListening(false);
        setInterimTranscript('');
        setStatus((prev) => (prev === 'listening' ? 'idle' : prev));
      };

      recognitionRef.current = rec;
      setListening(true);
      setStatus('listening');
      rec.start();
    } catch {
      setListening(false);
      setStatus('error');
      setErrorMessage(
        'Microphone dictation could not start. Type your summary below or switch to manual entry.'
      );
    }
  };

  const toggle = () => {
    if (listening) {
      stop();
    } else {
      start(activeLang);
    }
  };

  return {
    supported,
    listening,
    status,
    activeLang,
    finalTranscript,
    interimTranscript,
    errorMessage,
    setFinalTranscript,
    start,
    stop,
    toggle,
  };
}

interface SpeechInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string;
  onChangeValue: (val: string) => void;
  onDictated?: () => void;
  appendMode?: boolean;
  micLabel?: string;
}

export function SpeechInput({
  value,
  onChangeValue,
  onDictated,
  appendMode = false,
  micLabel = 'Dictate',
  className = '',
  ...rest
}: SpeechInputProps) {
  const { supported, listening, error, toggle } = useSpeechDictation((transcript) => {
    if (appendMode && value.trim()) {
      onChangeValue(`${value.trim()} ${transcript}`);
    } else {
      onChangeValue(transcript);
    }
    onDictated?.();
  });

  return (
    <div className="relative flex-1">
      <input
        {...rest}
        value={value}
        onChange={(e) => onChangeValue(e.target.value)}
        className={`w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 text-sm text-[#121513] dark:text-[#F4F1EA] placeholder:text-[#8B918B] focus:outline-none focus:ring-2 focus:ring-[#064E3B]/30 focus:border-[#064E3B] dark:focus:ring-[#10B981]/30 dark:focus:border-[#10B981] min-h-[44px] ${
          supported ? 'pr-12' : ''
        } ${className}`}
      />
      {supported && (
        <button
          type="button"
          onClick={toggle}
          title={listening ? 'Stop dictation' : micLabel}
          aria-label={listening ? 'Stop dictation' : micLabel}
          className={`absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
            listening
              ? 'bg-[#B91C1C] text-white'
              : 'text-[#5C635D] dark:text-[#9BA39D] hover:bg-[#F3EFE6] dark:hover:bg-[#1F2923] hover:text-[#064E3B] dark:hover:text-[#10B981]'
          }`}
        >
          {listening ? <Square className="w-3.5 h-3.5 fill-current" /> : <Mic className="w-4 h-4" />}
        </button>
      )}
      {error && <p className="mt-1 text-xs text-[#B91C1C] dark:text-red-400">{error}</p>}
    </div>
  );
}

interface SpeechTextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  value: string;
  onChangeValue: (val: string) => void;
  onDictated?: () => void;
  micLabel?: string;
}

export function SpeechTextarea({
  value,
  onChangeValue,
  onDictated,
  micLabel = 'Dictate note',
  className = '',
  ...rest
}: SpeechTextareaProps) {
  const { supported, listening, error, toggle } = useSpeechDictation((transcript) => {
    onChangeValue(value.trim() ? `${value.trim()} ${transcript}` : transcript);
    onDictated?.();
  });

  return (
    <div className="relative">
      <textarea
        {...rest}
        value={value}
        onChange={(e) => onChangeValue(e.target.value)}
        className={`w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 text-sm text-[#121513] dark:text-[#F4F1EA] placeholder:text-[#8B918B] focus:outline-none focus:ring-2 focus:ring-[#064E3B]/30 focus:border-[#064E3B] dark:focus:ring-[#10B981]/30 dark:focus:border-[#10B981] ${
          supported ? 'pr-12' : ''
        } ${className}`}
      />
      {supported && (
        <button
          type="button"
          onClick={toggle}
          title={listening ? 'Stop dictation' : micLabel}
          aria-label={listening ? 'Stop dictation' : micLabel}
          className={`absolute right-2 top-2 inline-flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
            listening
              ? 'bg-[#B91C1C] text-white'
              : 'text-[#5C635D] dark:text-[#9BA39D] hover:bg-[#F3EFE6] dark:hover:bg-[#1F2923] hover:text-[#064E3B] dark:hover:text-[#10B981]'
          }`}
        >
          {listening ? <Square className="w-3.5 h-3.5 fill-current" /> : <Mic className="w-4 h-4" />}
        </button>
      )}
      {error && <p className="mt-1 text-xs text-[#B91C1C] dark:text-red-400">{error}</p>}
    </div>
  );
}
