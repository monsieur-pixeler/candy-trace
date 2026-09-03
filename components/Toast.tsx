import * as React from 'react';
import { ToastMessage } from '../types';
import { CheckIcon, ErrorIcon, InfoIcon, XIcon } from './icons';
import { ToastState } from '../contexts/ToastContext';

const Toast: React.FC<{ toast: ToastMessage; onDismiss: (id: number) => void }> = ({ toast, onDismiss }) => {
    const [isVisible, setIsVisible] = React.useState(false);

    React.useEffect(() => {
        setIsVisible(true); // Animate in
        const timer = setTimeout(() => {
            setIsVisible(false); // Animate out
            setTimeout(() => onDismiss(toast.id), 300); // Remove after animation
        }, toast.duration);

        return () => clearTimeout(timer);
    }, [toast, onDismiss]);

    const ICONS = {
        success: <CheckIcon className="w-6 h-6 text-green-500" />,
        error: <ErrorIcon className="w-6 h-6 text-red-500" />,
        info: <InfoIcon className="w-6 h-6 text-blue-500" />,
    };

    const bgColors = {
        success: 'bg-green-50',
        error: 'bg-red-50',
        info: 'bg-blue-50',
    };

    return (
        <div
            className={`
                flex items-start p-4 w-full max-w-sm bg-white shadow-lg rounded-lg pointer-events-auto ring-1 ring-black ring-opacity-5 overflow-hidden
                transition-all duration-300 ease-in-out
                ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
            `}
        >
            <div className="flex-shrink-0">{ICONS[toast.type]}</div>
            <div className="ml-3 w-0 flex-1 pt-0.5">
                <p className="text-sm font-medium text-gray-900">{toast.message}</p>
            </div>
            <div className="ml-4 flex-shrink-0 flex">
                <button
                    onClick={() => onDismiss(toast.id)}
                    className="bg-white rounded-md inline-flex text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                    <span className="sr-only">Close</span>
                    <XIcon className="h-5 w-5" />
                </button>
            </div>
        </div>
    );
};

export const ToastContainer: React.FC = () => {
    const [toasts, setToasts] = React.useState(ToastState.toasts);

    React.useEffect(() => {
        const unsubscribe = ToastState.subscribe(() => {
            setToasts([...ToastState.toasts]);
        });
        return unsubscribe;
    }, []);
    
    const removeToast = (id: number) => {
        ToastState.toasts = ToastState.toasts.filter(t => t.id !== id);
    };

    return (
        <div
            aria-live="assertive"
            className="fixed inset-0 flex items-end px-4 py-6 pointer-events-none sm:p-6 sm:items-start z-50"
        >
            <div className="w-full flex flex-col items-center space-y-4 sm:items-end">
                {toasts.map(toast => (
                    <Toast key={toast.id} toast={toast} onDismiss={removeToast} />
                ))}
            </div>
        </div>
    );
};