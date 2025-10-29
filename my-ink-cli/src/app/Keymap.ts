import {useInput, useFocusManager} from 'ink';
import React from 'react';

export interface KeymapProps {
  isEditing: boolean;
  onToggleHelp: () => void;
  onOpenCommandPalette: () => void;
  onExitRequested: () => void;
  onEscape: () => void;
}

export const Keymap: React.FC<KeymapProps> = ({
  isEditing,
  onToggleHelp,
  onOpenCommandPalette,
  onExitRequested,
  onEscape
}) => {
  const focusManager = useFocusManager();

  useInput((input, key) => {
    if (key.tab) {
      if (key.shift) {
        focusManager.focusPrevious();
      } else {
        focusManager.focusNext();
      }
      return;
    }

    if (key.escape) {
      onEscape();
      return;
    }

    // When editing (e.g., typing in a TextInput or editor), suppress global single-key commands
    if (isEditing) {
      if (key.ctrl && input === 'c') {
        onExitRequested();
        return;
      }
      // Allow screens to handle their own shortcuts (e.g., save), but don't trigger global ones here
      return;
    }

    if (!key.ctrl && !key.meta) {
      if (input === '?') {
        onToggleHelp();
        return;
      }

      if (input === 'g') {
        onOpenCommandPalette();
        return;
      }

      if (input === 'q') {
        onExitRequested();
        return;
      }
    }

    if (key.ctrl && input === 'c') {
      onExitRequested();
      return;
    }
  });

  return null;
};

export default Keymap;
