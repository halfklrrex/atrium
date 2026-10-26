import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OfflineNotice } from './OfflineNotice';
import { useOnlineStatus } from './useOnlineStatus';
import { renderHook, act } from '@testing-library/react';

describe('useOnlineStatus hook', () => {
  const originalOnLine = navigator.onLine;

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      value: originalOnLine,
      configurable: true,
      writable: true,
    });
  });

  it('reflects browser online and offline status changes', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        value: false,
        configurable: true,
        writable: true,
      });
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(false);

    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        value: true,
        configurable: true,
        writable: true,
      });
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe(true);
  });
});

describe('OfflineNotice component', () => {
  const originalOnLine = navigator.onLine;

  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      value: originalOnLine,
      configurable: true,
      writable: true,
    });
  });

  it('renders nothing when the browser is online', () => {
    const { container } = render(<OfflineNotice />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('offline-notice')).toBeNull();
  });

  it('displays the offline banner when offline', () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
      writable: true,
    });
    render(<OfflineNotice />);

    const notice = screen.getByTestId('offline-notice');
    expect(notice).toBeInTheDocument();
    expect(
      screen.getByText("You're offline. Changes will sync when you reconnect."),
    ).toBeInTheDocument();
  });

  it('supports a custom offline message', () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
      writable: true,
    });
    render(<OfflineNotice message="Custom offline warning text" />);

    expect(screen.getByText('Custom offline warning text')).toBeInTheDocument();
  });

  it('can be dismissed when isCloseable is true', () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
      writable: true,
    });
    render(<OfflineNotice isCloseable />);

    expect(screen.getByTestId('offline-notice')).toBeInTheDocument();
    const closeBtn = screen.getByTestId('alert-banner-close-button');
    fireEvent.click(closeBtn);

    expect(screen.queryByTestId('offline-notice')).toBeNull();
  });
});
