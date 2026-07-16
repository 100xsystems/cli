import React from 'react';
import { Box, Text } from 'ink';

export interface TaskItem {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

interface TaskListProps {
  tasks: TaskItem[];
  title?: string;
}

/**
 * A task list that shows each task with its completion state.
 * Replaces manual chalk-based task logging.
 */
export function TaskList({ tasks, title }: TaskListProps) {
  return (
    <Box flexDirection="column" marginY={1}>
      {title && (
        <Box marginBottom={1}>
          <Text bold>{title}</Text>
        </Box>
      )}
      {tasks.map((task) => (
        <TaskItemRow key={task.id} task={task} />
      ))}
    </Box>
  );
}

function TaskItemRow({ task }: { task: TaskItem }) {
  const icon = getIcon(task.status);
  const color = getColor(task.status);

  return (
    <Box>
      <Text color={color}>{icon}</Text>
      <Text> {task.label}</Text>
      {task.status === 'running' && (
        <Text dimColor> ...</Text>
      )}
    </Box>
  );
}

function getIcon(status: TaskItem['status']): string {
  switch (status) {
    case 'pending': return '○';
    case 'running': return '⟳';
    case 'completed': return '✓';
    case 'failed': return '✗';
  }
}

function getColor(status: TaskItem['status']): string {
  switch (status) {
    case 'pending': return 'gray';
    case 'running': return 'cyan';
    case 'completed': return 'green';
    case 'failed': return 'red';
  }
}

export { getIcon as getTaskIcon, getColor as getTaskColor };
