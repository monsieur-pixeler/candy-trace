import * as React from 'react';
import type { Action, AppState, EnhanceSessionTurn, GeminiTurn, Settings, UnsavedTrace, WorkPair, GenHistory } from '../types';
import { geminiService } from '../services/geminiService';
import { getApiImageParts, dataUrlToFile } from '../utils/fileUtils';
import { Spinner, ErrorIcon, SendIcon, XIcon, CheckIcon } from './icons';
import { FileImagePreview } from './common';

export const EnhanceTraceModal: React.FC<{
    candyName: string;
    side: 'A' | 'B';
    originalPhoto: File;
    initialTraceUrl: string;
    originalPrompt: string;
    settings: Settings;
    onClose: () => void;
    onUpdateTrace: (newImageUrl: string, fullPrompt: string) => void;
    addLog: (level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR', message: string) => void;
}> = ({ candyName, side, originalPhoto, initialTraceUrl, originalPrompt, settings, onClose, onUpdateTrace, addLog }) => {

    const [currentTraceUrl, setCurrentTraceUrl] = React.useState<string | null>(initialTraceUrl || null);
    const [conversation, setConversation] = React.useState<EnhanceSessionTurn[]>([]);
    const [userInput, setUserInput] = React.useState('');
    const [isGenerating, setIsGenerating] = React.useState(false);

    const handleSend = async () => {
        if (!userInput.trim() || !originalPhoto) return;

        setIsGenerating(true);
        const currentUserInput = userInput;
        setUserInput('');

        const turnId = `turn_${Date.now()}`;
        const newTurn: EnhanceSessionTurn = {
            id: turnId,
            userInput: { text: currentUserInput },
            modelOutput: { imageUrl: null, responseText: null, error: null },
            status: 'pending',
        };
        setConversation(prev => [...prev, newTurn]);

        try {
            const traceToEditUrl = currentTraceUrl;
            if (!traceToEditUrl) throw new Error("Could not find a trace to edit.");

            const userParts: GeminiTurn['parts'] = [];
            // 1. Original Photo
            userParts.push(await getApiImageParts(originalPhoto).then(p => ({ inlineData: { ...p } })));
            
            // 2. Current Trace to be edited
            const traceToEditFile = await dataUrlToFile(traceToEditUrl, 'trace-to-edit.png');
            userParts.push(await getApiImageParts(traceToEditFile).then(p => ({ inlineData: { ...p } })));
            
            // 3. User's instruction
            const systemDrivenPrompt = `You are an AI assistant for refining technical line-art.
- The first image is the original photograph (ground truth).
- The second image is the current line-art trace.
- Your task is to edit the SECOND image based on the user's text instruction, using the first image as a reference for accuracy.
- The output MUST be a pure 1-bit black and white trace.

User Instruction: "${currentUserInput}"`;
            userParts.push({ text: systemDrivenPrompt });

            const geminiTurns: GeminiTurn[] = [{ role: 'user', parts: userParts }];
            
            const result = await geminiService.generateImageFromMultiModal(geminiTurns, null);
            if (!result.imageUrl) throw new Error("AI did not return an image.");
            
            setCurrentTraceUrl(result.imageUrl);

            setConversation(prev => prev.map(t => t.id === turnId ? { ...t, status: 'complete', modelOutput: { imageUrl: result.imageUrl || null, responseText: result.text || null, error: null } } : t));

        } catch (error) {
            const errorMessage = (error as Error).message;
            addLog('ERROR', `Enhancement failed: ${errorMessage}`);
            setConversation(prev => prev.map(t => t.id === turnId ? { ...t, status: 'error', modelOutput: { ...t.modelOutput, error: errorMessage } } : t));
        } finally {
            setIsGenerating(false);
        }
    };
    
    const handleUpdate = () => {
        if (!currentTraceUrl) {
            addLog('WARN', 'No final trace to update.');
            return;
        }
        const fullPrompt = `Original Prompt:\n${originalPrompt}\n\nEnhancement Conversation:\n` + conversation.map(t => `User: ${t.userInput.text}\nAI: ${t.modelOutput.responseText || 'Generated new image.'}`).join('\n');
        onUpdateTrace(currentTraceUrl, fullPrompt);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center p-4" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col relative" onClick={e => e.stopPropagation()}>
                <div className="flex-shrink-0 flex justify-between items-center border-b p-4">
                    <h2 className="text-xl font-bold">Co-pilot Enhancement: {candyName} (Side {side})</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200"><XIcon className="w-6 h-6" /></button>
                </div>
                
                <div className="flex-grow flex overflow-hidden">
                    {/* Left Column: Images */}
                    <div className="w-1/2 p-4 flex flex-col space-y-4 border-r overflow-y-auto">
                        <div>
                            <h3 className="text-sm font-semibold text-gray-600 mb-2 text-center">Original Photo</h3>
                            <div className="w-full aspect-square bg-gray-100 rounded-lg flex items-center justify-center p-1 border">
                                {originalPhoto && <FileImagePreview file={originalPhoto} className="max-w-full max-h-full object-contain" alt={`Original photo`} />}
                            </div>
                        </div>
                         <div>
                            <h3 className="text-sm font-semibold text-gray-600 mb-2 text-center">Current Trace</h3>
                            <div className="w-full aspect-square bg-gray-100 rounded-lg flex items-center justify-center p-1 border">
                                {currentTraceUrl ? (
                                    <img src={currentTraceUrl} className="max-w-full max-h-full object-contain" alt={`Current trace`} />
                                ) : (
                                    <p className="text-gray-500 text-sm">No trace generated yet.</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Chat */}
                    <div className="w-1/2 flex flex-col bg-gray-50">
                        <div className="flex-grow p-4 overflow-y-auto space-y-4">
                            {conversation.map(turn => (
                                <div key={turn.id}>
                                    <div className="p-3 bg-blue-100 rounded-lg text-gray-800">
                                        <p className="font-semibold text-sm">You</p>
                                        <p className="whitespace-pre-wrap text-sm">{turn.userInput.text}</p>
                                    </div>
                                    <div className="mt-2 p-3 bg-gray-200 rounded-lg text-gray-800">
                                        <p className="font-semibold text-sm text-purple-700">Co-pilot</p>
                                        {turn.status === 'pending' && <Spinner className="w-6 h-6 text-purple-500 my-2" title="Generating..." />}
                                        {turn.status === 'error' && (
                                            <div className="text-red-600 flex items-start mt-1 text-sm">
                                                <ErrorIcon className="w-5 h-5 mr-2 mt-0.5 flex-shrink-0" />
                                                <p>{turn.modelOutput.error}</p>
                                            </div>
                                        )}
                                        {turn.status === 'complete' && (
                                            <div className="mt-2 space-y-3">
                                                {turn.modelOutput.imageUrl && (
                                                    <div className="relative group inline-block">
                                                        <img src={turn.modelOutput.imageUrl} alt="Generated" className="max-w-[150px] rounded border border-gray-300" />
                                                        {currentTraceUrl !== turn.modelOutput.imageUrl && (
                                                            <button
                                                                onClick={() => setCurrentTraceUrl(turn.modelOutput.imageUrl)}
                                                                className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity rounded"
                                                            >
                                                                Use this version
                                                            </button>
                                                        )}
                                                        {currentTraceUrl === turn.modelOutput.imageUrl && (
                                                            <div className="absolute top-1 right-1 bg-green-500 text-white rounded-full p-0.5 shadow">
                                                                <CheckIcon className="w-3 h-3"/>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                                {turn.modelOutput.responseText && (
                                                    <p className="text-sm whitespace-pre-wrap">{turn.modelOutput.responseText}</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="flex-shrink-0 p-4 border-t bg-white">
                            <div className="flex items-center space-x-2">
                                <input
                                    type="text"
                                    value={userInput}
                                    onChange={e => setUserInput(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSend(); } }}
                                    className="flex-grow p-2 border rounded-md shadow-sm disabled:bg-gray-100"
                                    placeholder="e.g., Make the logo bolder..."
                                    disabled={isGenerating}
                                />
                                <button onClick={handleSend} disabled={isGenerating || !userInput.trim()} className="p-3 rounded-full bg-blue-600 text-white disabled:bg-gray-400">
                                    {isGenerating ? <Spinner className="w-5 h-5" /> : <SendIcon className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex-shrink-0 flex justify-end items-center space-x-3 border-t p-4 bg-gray-50">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">Cancel</button>
                    <button onClick={handleUpdate} disabled={isGenerating || currentTraceUrl === initialTraceUrl} className="inline-flex items-center px-4 py-2 text-sm font-semibold rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                        <CheckIcon className="w-5 h-5 mr-2 -ml-1" /> Update Trace & Close
                    </button>
                </div>
            </div>
        </div>
    );
};