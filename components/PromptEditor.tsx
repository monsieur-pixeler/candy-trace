import * as React from 'react';
import type { Action, PromptHistoryKey, PromptVersion, Settings } from '../types';

export const PromptEditor: React.FC<{
    label: string;
    promptHistory: PromptVersion[];
    activePromptId: string;
    promptHistoryKey: PromptHistoryKey;
    activePromptIdKey: keyof Settings;
    dispatch: React.Dispatch<Action>;
}> = ({ label, promptHistory, activePromptId, promptHistoryKey, activePromptIdKey, dispatch }) => {
    const activeVersion = promptHistory.find(v => v.id === activePromptId) || promptHistory[0];
    const [content, setContent] = React.useState(activeVersion.content);
    const [versionName, setVersionName] = React.useState('');

    React.useEffect(() => {
        const newActiveVersion = promptHistory.find(v => v.id === activePromptId) || promptHistory[0];
        setContent(newActiveVersion.content);
    }, [activePromptId, promptHistory]);

    const handleSaveNewVersion = () => {
        if (!versionName.trim()) {
            alert('Please provide a name for the new version.');
            return;
        }
        const newVersion: PromptVersion = {
            id: `prompt_${Date.now()}`,
            timestamp: Date.now(),
            name: versionName,
            content: content
        };
        dispatch({ type: 'ADD_PROMPT_VERSION', payload: { promptKey: promptHistoryKey, version: newVersion } });
        dispatch({ type: 'UPDATE_SETTINGS', payload: { [activePromptIdKey]: newVersion.id } });
        setVersionName('');
    };

    return (
        <div className="p-4 border border-gray-200 rounded-lg bg-gray-50/50">
            <label className="block text-sm font-medium text-gray-700">{label}</label>
            <select
                value={activePromptId}
                onChange={e => dispatch({ type: 'UPDATE_SETTINGS', payload: { [activePromptIdKey]: e.target.value } })}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            >
                {promptHistory.map(v => (
                    <option key={v.id} value={v.id}>
                        {v.name} ({new Date(v.timestamp).toLocaleDateString()})
                    </option>
                ))}
            </select>
            <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                rows={8}
                className="mt-2 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm font-mono"
            />
            <div className="mt-2 flex items-center space-x-2">
                <input
                    type="text"
                    value={versionName}
                    onChange={e => setVersionName(e.target.value)}
                    placeholder="New version name..."
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                />
                <button
                    onClick={handleSaveNewVersion}
                    disabled={!versionName.trim()}
                    className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:bg-gray-300"
                >
                    Save as New Version
                </button>
            </div>
        </div>
    );
};
