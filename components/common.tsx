import * as React from 'react';
import { useDropzone } from 'react-dropzone';
import { BUCKETS } from '../constants';
import type { Bucket } from '../types';
import { ChevronDownIcon, CheckIcon, ErrorIcon, InfoIcon, Spinner, UploadIcon, XIcon } from './icons';
import { dbService } from '../services/dbService';

export const StatCard = ({ icon, title, value, color, onClick }: { icon: React.ElementType, title: string, value: number | string, color: string, onClick?: () => void }) => {
    const Icon = icon;

    const content = (
        <>
            <div className={`rounded-full p-3 ${color}`}>
                <Icon className="w-7 h-7 text-white" />
            </div>
            <div>
                <p className="text-sm font-medium text-gray-500">{title}</p>
                <p className="text-3xl font-bold text-gray-800">{value}</p>
            </div>
        </>
    );

    if (onClick) {
        return (
            <button 
                onClick={onClick} 
                className="bg-white p-6 rounded-xl shadow-md border flex items-start space-x-4 w-full text-left transition-all duration-200 hover:shadow-lg hover:border-blue-400 hover:-translate-y-1"
            >
                {content}
            </button>
        );
    }

    return (
        <div className="bg-white p-6 rounded-xl shadow-md border flex items-start space-x-4">
            {content}
        </div>
    );
};

export const ActionButton = ({ icon, title, description, onClick, color, count }: { icon: React.ElementType, title: string, description: string, onClick: () => void, color: string, count?: number }) => {
    const Icon = icon;
    return (
        <button onClick={onClick} className={`relative text-left bg-white p-6 rounded-xl shadow-md border flex items-start space-x-4 w-full h-full hover:border-gray-300 hover:shadow-lg transition-all`}>
            {count !== undefined && count > 0 && (
                <span className="absolute top-3 right-3 bg-yellow-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                    {count}
                </span>
            )}
            <div className={`rounded-full p-4 ${color}`}>
                <Icon className="w-8 h-8 text-white" />
            </div>
            <div>
                <h3 className="text-lg font-bold text-gray-800">{title}</h3>
                <p className="text-sm text-gray-600">{description}</p>
            </div>
        </button>
    );
};

export const TabButton: React.FC<{name: string, id: string, activeTab: string, setActiveTab: (id: any) => void}> = ({ name, id, activeTab, setActiveTab }) => (
    <button
        onClick={() => setActiveTab(id)}
        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors duration-150 capitalize
            ${activeTab === id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
        `}
    >
        {name}
    </button>
);

export const BucketSelector: React.FC<{ onSelect: (bucket: Bucket) => void; buttonText?: string }> = ({ onSelect, buttonText = "Assign to Bucket" }) => {
    const [isOpen, setIsOpen] = React.useState(false);
    return (
        <div className="relative inline-block text-left">
            <button onClick={() => setIsOpen(!isOpen)} className="inline-flex justify-center w-full rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none">
                {buttonText}
                <ChevronDownIcon className="-mr-1 ml-2 h-5 w-5" />
            </button>
            {isOpen && (
                <div className="origin-top-right absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-10 max-h-60 overflow-y-auto">
                    <div className="py-1" role="menu" aria-orientation="vertical">
                        {BUCKETS.map((bucket) => (
                             <a href="#" key={bucket} onClick={(e) => { e.preventDefault(); onSelect(bucket); setIsOpen(false); }} className="text-gray-700 block px-4 py-2 text-sm hover:bg-gray-100">{bucket}</a>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export const StatusIcon: React.FC<{ status: string, error?: string }> = ({ status, error }) => {
    switch (status) {
        case 'idle': return <InfoIcon className="w-5 h-5 text-gray-400" title="Idle"/>;
        case 'queued':
        case 'classifying':
        case 'analyzing':
        case 'comparing':
        case 'matching':
        case 'processing':
        case 'processing_stage1':
        case 'processing_stage2':
        case 'extracting':
             return <Spinner className="w-5 h-5 text-blue-500" title={status}/>;
        case 'analyzed':
        case 'classified':
        case 'compared':
        case 'matched':
        case 'done':
            return <CheckIcon className="w-5 h-5 text-green-500" title="Completed"/>;
        case 'error':
             return <ErrorIcon className="w-5 h-5 text-red-500" title={`Error: ${error}`}/>;
        default:
            return null;
    }
};

export const NavItem: React.FC<{ icon: React.ElementType; label: string; isActive: boolean; onClick: () => void; count?: number }> = ({ icon: Icon, label, isActive, onClick, count }) => (
    <button
        onClick={onClick}
        className={`flex items-center justify-between w-full px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
            isActive
                ? 'bg-blue-600 text-white'
                : 'text-gray-200 hover:bg-gray-700 hover:text-white'
        }`}
    >
        <div className="flex items-center">
            <Icon className="w-6 h-6 mr-3" />
            <span>{label}</span>
        </div>
        {count !== undefined && count > 0 && (
            <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                isActive ? 'bg-blue-400 text-white' : 'bg-gray-600 text-gray-100'
            }`}>
                {count}
            </span>
        )}
    </button>
);

export const ImageSlot: React.FC<{ file: File | null; onDrop: (file: File) => void; onClear: () => void; title: string; }> = ({ file, onDrop, onClear, title }) => {
    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop: (acceptedFiles) => onDrop(acceptedFiles[0]), accept: { 'image/*': [] }, multiple: false });

    return (
        <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">{title}</label>
            <div {...getRootProps()} className={`w-full h-48 border-2 border-dashed rounded-lg flex items-center justify-center text-center cursor-pointer transition-colors ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:border-gray-400'}`}>
                <input {...getInputProps()} />
                {file ? (
                    <FileImagePreview file={file} className="max-h-full max-w-full object-contain rounded" alt="Preview" />
                ) : (
                    <div className="text-gray-500">
                        <UploadIcon className="w-8 h-8 mx-auto mb-2" />
                        <p className="text-sm">Drop photo here, or click to select</p>
                    </div>
                )}
            </div>
            {file && (
                <button onClick={onClear} className="absolute top-8 right-2 p-1 bg-gray-800 text-white rounded-full hover:bg-red-600 transition-colors">
                    <XIcon className="w-4 h-4" />
                </button>
            )}
        </div>
    );
};

export const Modal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4" 
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div 
        className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl" 
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center border-b pb-3 mb-4">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200" aria-label="Close modal">
            <XIcon className="w-6 h-6" />
          </button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
};

export const FileImagePreview: React.FC<{ file?: File | null, className?: string, alt: string }> = ({ file, className, alt }) => {
    const [url, setUrl] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!file) {
            setUrl(null);
            return;
        }
        const objectUrl = URL.createObjectURL(file);
        setUrl(objectUrl);

        return () => URL.revokeObjectURL(objectUrl);
    }, [file]);

    if (!url) {
        const placeholderClass = `flex items-center justify-center bg-gray-100 rounded-md text-xs text-gray-400 ${className}`;
        return <div className={placeholderClass}><span>No Img</span></div>;
    }

    return <img src={url} className={className} alt={alt} />;
};

export const DbFileImagePreview: React.FC<{ imageKey?: string; className?: string; alt: string }> = ({ imageKey, className, alt }) => {
    const [file, setFile] = React.useState<File | null>(null);
    React.useEffect(() => {
        let isMounted = true;
        setFile(null);
        if (imageKey) {
            dbService.getFileLocal(imageKey).then(f => {
                if (isMounted) setFile(f || null);
            }).catch(console.error);
        }
        return () => { isMounted = false; };
    }, [imageKey]);

    return <FileImagePreview file={file} className={className} alt={alt} />;
};


// --- NEW ACTION BAR COMPONENTS ---

export const ActionBar: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return (
        <div className="px-4 py-2 bg-white border-b border-gray-200 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
                {children}
            </div>
        </div>
    );
};

export const ActionBarButton: React.FC<{
    onClick: () => void;
    disabled?: boolean;
    variant?: 'primary' | 'secondary' | 'destructive' | 'text';
    icon?: React.ElementType;
    children: React.ReactNode;
    title?: string;
    count?: number;
}> = ({ onClick, disabled, variant = 'secondary', icon: Icon, children, title, count }) => {
    const baseClasses = "relative inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500";
    const variantClasses = {
        primary: 'bg-blue-600 text-white hover:bg-blue-700 border border-transparent',
        secondary: 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50',
        destructive: 'bg-white text-red-600 hover:bg-red-50 border border-transparent',
        text: 'bg-transparent text-blue-600 hover:bg-blue-50 border border-transparent px-2',
    };
    const disabledClasses = "opacity-50 cursor-not-allowed";

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`${baseClasses} ${variantClasses[variant]} ${disabled ? disabledClasses : ''}`}
            title={title}
        >
            {Icon && <Icon className="w-4 h-4 mr-1.5" />}
            {children}
            {count !== undefined && count > 0 && (
                <span className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-red-100 transform translate-x-1/2 -translate-y-1/2 bg-red-600 rounded-full">
                    {count}
                </span>
            )}
        </button>
    );
};

export const ActionBarIconButton: React.FC<{
    onClick: () => void;
    disabled?: boolean;
    variant?: 'secondary' | 'destructive';
    icon: React.ElementType;
    label: string;
}> = ({ onClick, disabled, variant = 'secondary', icon: Icon, label }) => {
    const baseClasses = "inline-flex items-center justify-center rounded-md p-2 text-sm font-medium transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500";
    const variantClasses = {
        secondary: 'bg-white border border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700',
        destructive: 'bg-white text-gray-500 hover:bg-red-50 hover:text-red-600 border border-gray-300 hover:border-red-300'
    };
    const disabledClasses = "opacity-50 cursor-not-allowed";

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={label}
            className={`${baseClasses} ${variantClasses[variant]} ${disabled ? disabledClasses : ''}`}
        >
            <span className="sr-only">{label}</span>
            <Icon className="w-4 h-4" />
        </button>
    );
};

export const ActionBarDropdown: React.FC<{
    label: React.ReactNode;
    options: { label: string; value: string; description?: string }[];
    onSelect: (value: string) => void;
    disabled?: boolean;
    variant?: 'secondary';
}> = ({ label, options, onSelect, disabled, variant = 'secondary' }) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const ref = React.useRef<HTMLDivElement>(null);
    
    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) setIsOpen(false);
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [ref]);

    const baseClasses = "inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500";
    const variantClasses = {
        secondary: 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50',
    };
    const disabledClasses = "opacity-50 cursor-not-allowed";

    return (
        <div className="relative inline-block text-left" ref={ref}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                disabled={disabled}
                className={`${baseClasses} ${variantClasses[variant]} ${disabled ? disabledClasses : ''}`}
            >
                {label}
                <ChevronDownIcon className="w-4 h-4 ml-1.5 -mr-1" />
            </button>
            {isOpen && (
                <div className="origin-top-left absolute left-0 mt-2 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-20 max-h-60 overflow-y-auto">
                    <div className="py-1">
                        {options.map(option => (
                            <a
                                href="#"
                                key={option.value}
                                onClick={(e) => { e.preventDefault(); onSelect(option.value); setIsOpen(false); }}
                                className="text-gray-700 block px-4 py-2 text-sm hover:bg-gray-100"
                            >
                                <p className="font-medium">{option.label}</p>
                                {option.description && <p className="text-xs text-gray-500">{option.description}</p>}
                            </a>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export const ActionBarDivider: React.FC = () => <div className="h-6 w-px bg-gray-200" />;

export const ActionBarLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => <span className="text-sm font-medium text-gray-500 px-2">{children}</span>;
