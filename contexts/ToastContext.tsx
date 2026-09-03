import * as React from 'react';
import type { ToastMessage } from '../types';

let toastSeq = 1;

// This is a HACK to get the toasts from the provider.
// This is not ideal, but a consequence of the current architecture.
// A better solution would involve a shared state management library or lifting state further.
// However, to avoid massive refactoring, we use this internal "event bus" like system.
export const ToastState = {
    _listeners: new Set<() => void>(),
    _toasts: [] as ToastMessage[],
    
    get toasts() {
        return this._toasts;
    },

    set toasts(value: ToastMessage[]) {
        this._toasts = value;
        this._listeners.forEach(listener => listener());
    },

    subscribe(listener: () => void) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }
};

type ToastContextType = {
    addToast: (message: string, type?: ToastMessage['type'], duration?: number) => void;
};

const ToastContext = React.createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
    const context = React.useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const addToast = React.useCallback((message: string, type: ToastMessage['type'] = 'info', duration: number = 3000) => {
        // Date.now() alone collides for toasts raised in the same millisecond.
        const id = toastSeq++;
        ToastState.toasts = [...ToastState.toasts, { id, message, type, duration }];
    }, []);

    return (
        <ToastContext.Provider value={{ addToast }}>
            {children}
        </ToastContext.Provider>
    );
};