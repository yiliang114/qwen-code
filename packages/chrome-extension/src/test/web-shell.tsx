/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactNode } from 'react';

interface StatusItem {
  label: ReactNode;
  onClick?(): void;
}

export function WebShellWithProviders({
  bottomStatusItems,
}: {
  bottomStatusItems?: StatusItem[];
}) {
  return (
    <main id="web-shell">
      {bottomStatusItems?.map((item, index) => (
        <button
          id={`web-shell-status-${index}`}
          key={index}
          type="button"
          onClick={item.onClick}
        >
          {item.label}
        </button>
      ))}
    </main>
  );
}
