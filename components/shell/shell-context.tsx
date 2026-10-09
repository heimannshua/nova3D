'use client';

import {createContext, useContext} from 'react';

type ShellActions = {openCreate: () => void};

const ShellContext = createContext<ShellActions>({openCreate: () => undefined});

export const ShellProvider = ShellContext;

/** Actions the shell owns, such as opening the Create dialog from a page's own button. */
export function useShell(): ShellActions {
  return useContext(ShellContext);
}
