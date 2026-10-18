'use client';

import {createContext, useContext} from 'react';

type ShellActions = {
  openCreate: () => void;
  /** Opens the Create dialog with Upload picture already chosen (the text flow's "start from a picture instead"). */
  openCreatePicture: () => void;
};

const ShellContext = createContext<ShellActions>({openCreate: () => undefined, openCreatePicture: () => undefined});

export const ShellProvider = ShellContext;

/** Actions the shell owns, such as opening the Create dialog from a page's own button. */
export function useShell(): ShellActions {
  return useContext(ShellContext);
}
