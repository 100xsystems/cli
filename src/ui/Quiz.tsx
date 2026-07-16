import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import SelectInput from './SelectInput.js';
import { Divider } from './Divider.js';
import type { QuizData } from '../reader/index.js';

interface QuizAppProps {
  quizzes: QuizData[];
  systemTitle: string;
  onDone: (score: { correct: number; total: number }) => void;
}

interface QuizState {
  currentQuiz: number;
  currentQuestion: number;
  correct: number;
  totalAnswered: number;
  answered: boolean;
  lastCorrect: boolean | null;
  lastAnswer: string | boolean | null;
  finished: boolean;
}

/**
 * Interactive quiz application using Ink.
 * Renders one question at a time with multiple-choice or true/false options.
 */
export function QuizApp({ quizzes, systemTitle, onDone }: QuizAppProps) {
  const [state, setState] = useState<QuizState>({
    currentQuiz: 0,
    currentQuestion: 0,
    correct: 0,
    totalAnswered: 0,
    answered: false,
    lastCorrect: null,
    lastAnswer: null,
    finished: false,
  });

  const { exit } = useApp();
  const mountedRef = useRef(true);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitCalledRef = useRef(false);

  // Handle exit as a side effect of state.finished, not inside setTimeout closures
  useEffect(() => {
    if (state.finished && !exitCalledRef.current) {
      exitCalledRef.current = true;
      onDone({ correct: state.correct, total: state.totalAnswered });
      exit();
    }
  }, [state.finished, state.correct, state.totalAnswered, onDone]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    };
  }, []);

  if (quizzes.length === 0) {
    return <Text color="yellow">  No quizzes available.</Text>;
  }

  if (state.finished) {
    const total = state.totalAnswered;
    const percentage = total > 0 ? Math.round((state.correct / total) * 100) : 0;
    const scoreColor: string = percentage >= 80 ? 'green' : percentage >= 50 ? 'yellow' : 'red';

    return (
      <Box flexDirection="column" paddingX={2}>
        <Divider />
        <Text bold>{'  '}Results: <Text color={scoreColor}>{state.correct}/{total} ({percentage}%)</Text></Text>
        {percentage === 100 && <Text color="green">  Perfect score! Excellent work!</Text>}
        {percentage >= 80 && percentage < 100 && <Text color="green">  Great job! Almost perfect.</Text>}
        {percentage >= 50 && percentage < 80 && <Text color="yellow">  Good effort! Review the topics you missed.</Text>}
        {percentage < 50 && <Text color="red">  Keep studying! Review the system content and try again.</Text>}
      </Box>
    );
  }

  const quiz = quizzes[state.currentQuiz];
  const question = quiz.questions[state.currentQuestion];

  const handleSelect = useCallback((item: { value: string | boolean }) => {
    if (state.answered) return;
    const isCorrect = item.value === question.answer;

    setState(prev => ({
      ...prev,
      answered: true,
      lastCorrect: isCorrect,
      lastAnswer: item.value,
      correct: isCorrect ? prev.correct + 1 : prev.correct,
      totalAnswered: prev.totalAnswered + 1,
    }));

    // Auto-advance after a brief delay
    advanceTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;

      setState(prev => {
        const isLastQuestion = prev.currentQuestion + 1 >= quiz.questions.length;
        const isLastQuiz = prev.currentQuiz + 1 >= quizzes.length;

        if (isLastQuestion && isLastQuiz) {
          return { ...prev, finished: true };
        }

        if (isLastQuestion) {
          return {
            ...prev,
            currentQuiz: prev.currentQuiz + 1,
            currentQuestion: 0,
            answered: false,
            lastCorrect: null,
            lastAnswer: null,
          };
        }

        return {
          ...prev,
          currentQuestion: prev.currentQuestion + 1,
          answered: false,
          lastCorrect: null,
          lastAnswer: null,
        };
      });

      // Exit is handled by useEffect watching state.finished — no stale closure issue
    }, 1000);
  }, [state.answered, question, quiz.questions.length, quizzes.length]);

  const choices = question.type === 'true-false'
    ? [{ label: 'True', value: true }, { label: 'False', value: false }]
    : (question.choices || []).map(c => ({ label: c.label, value: c.value }));

  return (
    <Box flexDirection="column" paddingX={2}>
      <Text bold>{'  '}📝 {quiz.title}</Text>
      <Text dimColor>{'  '}────────────────────────────────────────</Text>

      <Box marginY={1}>
        <Text bold>{'  '}Q{state.currentQuestion + 1}. {question.question}</Text>
      </Box>

      {!state.answered && (
        <Box marginLeft={2}>
          <SelectInput items={choices} onSelect={handleSelect} />
        </Box>
      )}

      {state.answered && (
        <Box marginTop={1} marginLeft={2}>
          {state.lastCorrect ? (
            <Box>
              <Text color="green">✓ Correct!</Text>
            </Box>
          ) : (
            <Box>
              <Text color="red">✗ Incorrect. The correct answer was: <Text bold>{String(question.answer)}</Text></Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
