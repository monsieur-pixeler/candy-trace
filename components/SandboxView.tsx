import * as React from 'react';
import { useDropzone } from 'react-dropzone';
import type { Action, AppState, GeminiTurn, SandboxSessionTurn, Pill, StyleSet, PromptVersion, UnsavedTrace, PromptHistoryKey, Settings } from '../types';
import { geminiService } from '../services/geminiService';
import { dbService } from '../services/dbService';
import { getApiImageParts, dataUrlToFile } from '../utils/fileUtils';
import { UploadIcon, SendIcon, SparklesIcon, Spinner, ErrorIcon, XIcon, RefreshIcon, PaperClipIcon, ArchiveIcon } from './icons';
import { BLANK_CANVAS_INSTRUCTION, TRANSPARENT_BACKGROUND_INSTRUCTION } from '../constants';
import { cleanImageToOneBit } from '../utils/imageUtils';
import { FileImagePreview } from './common';

// A styled dropzone component local to the Sandbox view
const DropzoneComponent: React.FC<{
  title: string;
  onDrop: (files: File[]) => void;
  children: React.ReactNode;
  className?: string;
  accept?: { [key: string]: string[] };
  maxFiles?: number;
}> = ({ title, onDrop, children, className, accept, maxFiles }) => {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept, maxFiles });

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{title}</label>
      <div
        {...getRootProps()}
        className={`bg-white p-4 border-2 border-dashed rounded-lg flex flex-col items-center justify-center text-center cursor-pointer transition-colors
          ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
          ${className}`}
      >
        <input {...getInputProps()} />
        {children}
      </div>
    </div>
  );
};

const CandyPickerModal: React.FC<{
  pills: Pill[];
  onSelect: (file: File) => void;
  onClose: () => void;
}> = ({ pills, onSelect, onClose }) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center border-b pb-3 mb-4">
          <h2 className="text-2xl font-bold">Pick from Candy Library</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200"><XIcon className="w-6 h-6" /></button>
        </div>
        <div className="overflow-y-auto">
          {pills.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {pills.map(pill => (
                <React.Fragment key={pill.id}>
                  {pill.A.originalFile && (
                    <div className="border rounded-lg p-2 group flex flex-col">
                      <FileImagePreview file={pill.A.originalFile} alt={`${pill.name} - Side A`} className="w-full h-32 object-contain rounded bg-gray-100" />
                      <p className="text-sm font-medium mt-2 truncate flex-grow">{pill.name} (Side A)</p>
                      <button onClick={() => onSelect(pill.A.originalFile!)} className="w-full mt-2 text-sm bg-blue-500 text-white py-1 rounded hover:bg-blue-600">Select</button>
                    </div>
                  )}
                  {pill.B.originalFile && (
                    <div className="border rounded-lg p-2 group flex flex-col">
                      <FileImagePreview file={pill.B.originalFile} alt={`${pill.name} - Side B`} className="w-full h-32 object-contain rounded bg-gray-100" />
                      <p className="text-sm font-medium mt-2 truncate flex-grow">{pill.name} (Side B)</p>
                      <button onClick={() => onSelect(pill.B.originalFile!)} className="w-full mt-2 text-sm bg-blue-500 text-white py-1 rounded hover:bg-blue-600">Select</button>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          ) : (
             <div className="text-center py-12 text-gray-500">Your Candy Library is empty.</div>
          )}
        </div>
      </div>
    </div>
  );
};

const StylePickerModal: React.FC<{
  styleSets: StyleSet[];
  onSelect: (files: File[]) => void;
  onClose: () => void;
}> = ({ styleSets, onSelect, onClose }) => {
  const [selectedFiles, setSelectedFiles] = React.useState<File[]>([]);

  const handleToggleSelection = (file: File) => {
    setSelectedFiles(prev => {
      const isSelected = prev.some(f => f.name === file.name && f.size === file.size);
      if (isSelected) {
        return prev.filter(f => f.name !== file.name || f.size !== file.size);
      }
      if (prev.length < 2) {
        return [...prev, file];
      }
      return prev;
    });
  };
  
  const handleConfirm = () => {
    onSelect(selectedFiles);
    onClose();
  };

  const isFileSelected = (file: File) => {
    return selectedFiles.some(f => f.name === file.name && f.size === file.size);
  }

  const activeStyles = styleSets.filter(s => s.active && (s.A.traceFile || s.B.traceFile));

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-6xl max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center border-b pb-3 mb-4">
          <h2 className="text-2xl font-bold">Pick from Style Library ({selectedFiles.length}/2 selected)</h2>
          <div>
            <button onClick={handleConfirm} disabled={selectedFiles.length === 0} className="mr-4 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400">Confirm Selection</button>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200"><XIcon className="w-6 h-6" /></button>
          </div>
        </div>
        <div className="overflow-y-auto">
          {activeStyles.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {activeStyles.map(style => (
                <React.Fragment key={style.id}>
                  {style.A.traceFile && (
                    <div
                      onClick={() => handleToggleSelection(style.A.traceFile!)}
                      className={`border-2 p-2 rounded-lg cursor-pointer ${isFileSelected(style.A.traceFile) ? 'border-blue-500' : 'border-transparent hover:border-gray-300'}`}
                    >
                      <FileImagePreview file={style.A.traceFile} alt={`${style.name} - Trace A`} className="w-full h-32 object-contain rounded bg-gray-100" />
                      <p className="text-sm font-medium mt-2 truncate">{style.name} (Trace A)</p>
                    </div>
                  )}
                  {style.B.traceFile && (
                    <div
                      onClick={() => handleToggleSelection(style.B.traceFile!)}
                      className={`border-2 p-2 rounded-lg cursor-pointer ${isFileSelected(style.B.traceFile) ? 'border-blue-500' : 'border-transparent hover:border-gray-300'}`}
                    >
                      <FileImagePreview file={style.B.traceFile} alt={`${style.name} - Trace B`} className="w-full h-32 object-contain rounded bg-gray-100" />
                      <p className="text-sm font-medium mt-2 truncate">{style.name} (Trace B)</p>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          ) : (
             <div className="text-center py-12 text-gray-500">No active styles with trace images found in your Style Library.</div>
          )}
        </div>
      </div>
    </div>
  );
};

export const SandboxView: React.FC<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
  addLog: (level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR', message: string) => void;
}> = ({ state, dispatch, addLog }) => {
  const [candyPhoto, setCandyPhoto] = React.useState<File | null>(null);
  const [styleTraces, setStyleTraces] = React.useState<File[]>([]);
  const [mainPrompt, setMainPrompt] = React.useState('');
  const [sandboxSystemInstruction, setSandboxSystemInstruction] = React.useState(state.settings.systemInstruction);
  const [sessionTurns, setSessionTurns] = React.useState<SandboxSessionTurn[]>([]);
  const [refinementPrompt, setRefinementPrompt] = React.useState('');
  const [refinementImage, setRefinementImage] = React.useState<File | null>(null);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [isCandyPickerOpen, setIsCandyPickerOpen] = React.useState(false);
  const [isStylePickerOpen, setIsStylePickerOpen] = React.useState(false);
  const [apiMode, setApiMode] = React.useState<'direct' | 'conversational'>(state.settings.sandboxApiMode);
  
  // Fix: Replaced outdated prompt sets ('main', 'refTrace') with current ones ('simpleTrace', 'dynamicSimpleTrace')
  // to align with the application's settings and state structure.
  const [selectedPromptSet, setSelectedPromptSet] = React.useState<'custom' | 'simpleTrace' | 'dynamicSimpleTrace'>('custom');
  const [targetPromptSet, setTargetPromptSet] = React.useState<'simpleTrace' | 'dynamicSimpleTrace'>(() => {
    return state.settings.activePromptSet;
  });

  // State for the "Save to Library" modal
  const [saveModalState, setSaveModalState] = React.useState<{ isOpen: boolean; turn: SandboxSessionTurn | null }>({ isOpen: false, turn: null });
  const [saveTraceName, setSaveTraceName] = React.useState('');
  const [saveTraceSide, setSaveTraceSide] = React.useState<'A' | 'B'>('A');

  const promptSetOptions: Record<'simpleTrace' | 'dynamicSimpleTrace', string> = {
    simpleTrace: 'Simple Trace',
    dynamicSimpleTrace: 'Dynamic Simple Trace',
  };

  React.useEffect(() => {
    if (state.sandboxInitialData) {
        const { candyPhoto, styleTraces, mainPrompt, systemInstruction, sessionTurns } = state.sandboxInitialData;

        // Reset state before loading new data
        setCandyPhoto(null);
        setStyleTraces([]);
        setMainPrompt('');
        setSandboxSystemInstruction(state.settings.systemInstruction);
        setSessionTurns([]);
        setRefinementPrompt('');
        setRefinementImage(null);
        setSelectedPromptSet('custom');

        // Load new data
        if (candyPhoto) setCandyPhoto(candyPhoto);
        if (styleTraces) setStyleTraces(styleTraces);
        if (mainPrompt) setMainPrompt(mainPrompt);
        if (systemInstruction) setSandboxSystemInstruction(systemInstruction);
        if (sessionTurns) setSessionTurns(sessionTurns);

        // Clean up initial data in global state
        dispatch({ type: 'SET_SANDBOX_INITIAL_DATA', payload: null });
    }
  }, [state.sandboxInitialData, dispatch, state.settings.systemInstruction]);

  React.useEffect(() => {
    if (sessionTurns.length === 0) {
        setSandboxSystemInstruction(state.settings.systemInstruction);
    }
    setApiMode(state.settings.sandboxApiMode);
  }, [state.settings.systemInstruction, state.settings.sandboxApiMode, sessionTurns.length]);

  const handleSelectCandy = (file: File) => {
    setCandyPhoto(file);
    setIsCandyPickerOpen(false);
  };
  
  const handleSelectStyles = (files: File[]) => {
    setStyleTraces(files);
    setIsStylePickerOpen(false);
  };

  const handleMainPromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMainPrompt(e.target.value);
    setSelectedPromptSet('custom');
  };

  const handlePromptSetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      // Fix: Updated to handle current prompt sets ('simpleTrace', 'dynamicSimpleTrace') and load prompts from the correct state properties.
      const value = e.target.value as 'custom' | 'simpleTrace' | 'dynamicSimpleTrace';
      setSelectedPromptSet(value);

      if (value === 'custom') {
          return;
      }

      setTargetPromptSet(value);
      let history: PromptVersion[];
      let activeId: string;

      switch (value) {
          case 'simpleTrace':
              history = state.settings.simpleTraceMainPromptHistory;
              activeId = state.settings.activeSimpleTraceMainPromptId;
              break;
          case 'dynamicSimpleTrace':
              history = state.settings.dynamicSimpleTraceMainPromptHistory;
              activeId = state.settings.activeDynamicSimpleTraceMainPromptId;
              break;
      }
      
      const activePrompt = history.find(p => p.id === activeId);
      if (activePrompt) {
          setMainPrompt(activePrompt.content);
          setSandboxSystemInstruction(state.settings.systemInstruction);
      }
  };

  const handleResetSession = () => {
      if (sessionTurns.length > 0 && window.confirm('Are you sure you want to reset the sandbox chat? This cannot be undone.')) {
          setSessionTurns([]);
          setRefinementPrompt('');
          setRefinementImage(null);
      }
  };

  const handleSaveSession = async () => {
    try {
      await dbService.saveSandboxSession({
        candyPhoto,
        styleTraces,
        mainPrompt,
        systemInstruction: sandboxSystemInstruction,
        sessionTurns,
      });
      addLog('SUCCESS', 'Sandbox session saved successfully!');
    } catch (error) {
      addLog('ERROR', `Error saving session: ${(error as Error).message}`);
    }
  };

  const handleLoadSession = async () => {
    if (window.confirm('Loading a session will overwrite your current sandbox. Continue?')) {
      try {
        const session = await dbService.restoreSandboxSession();
        if (session) {
          setCandyPhoto(session.candyPhoto);
          setStyleTraces(session.styleTraces);
          setMainPrompt(session.mainPrompt);
          setSandboxSystemInstruction(session.systemInstruction);
          setSessionTurns(session.sessionTurns);
          setSelectedPromptSet('custom'); // Loaded prompt is always custom
          addLog('SUCCESS', 'Sandbox session restored.');
        } else {
          addLog('INFO', 'No saved sandbox session found.');
        }
      } catch (error) {
        addLog('ERROR', `Error loading session: ${(error as Error).message}`);
      }
    }
  };

  const handleImageAttachment = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          setRefinementImage(e.target.files[0]);
      }
      e.target.value = ''; // Allow re-uploading the same file
  };

  const handleInitialGenerate = React.useCallback(async () => {
    if (!candyPhoto) {
      addLog('WARN', 'Please provide a Candy Photo to begin.');
      return;
    }
    if (!mainPrompt.trim()) {
      addLog('WARN', 'Please enter a Main Prompt for the first generation.');
      return;
    }

    setIsGenerating(true);
    const turnId = `turn_${Date.now()}`;

    let promptForApi = mainPrompt;
    if (state.settings.outputBackground === 'transparent') {
        promptForApi += `\n\n${TRANSPARENT_BACKGROUND_INSTRUCTION}`;
    } else if (state.settings.forceBlankCanvas) {
        promptForApi += `\n\n${BLANK_CANVAS_INSTRUCTION}`;
    }

    const newTurn: SandboxSessionTurn = {
      id: turnId,
      userInput: { text: promptForApi, isInitialPrompt: true },
      modelOutput: { finalImageUrl: null, responseText: null, error: null },
      status: 'pending',
    };

    setSessionTurns([newTurn]);

    try {
      const images: File[] = [candyPhoto, ...styleTraces];
      const imageParts = await Promise.all(
        images.map(async (file) => {
          const { data, mimeType } = await getApiImageParts(file);
          return { inlineData: { data, mimeType } };
        })
      );

      const currentUserParts: GeminiTurn['parts'] = [...imageParts, { text: promptForApi }];
      const conversationForApi: GeminiTurn[] = [{ role: 'user', parts: currentUserParts }];
      
      const systemInstruction = state.settings.systemInstructionEnabled ? sandboxSystemInstruction : null;
      const result = await geminiService.generateImageFromMultiModal(conversationForApi, systemInstruction);
      
      let finalImageUrl = result.imageUrl || null;
      if (finalImageUrl && state.settings.autoCleanTrace) {
          finalImageUrl = await cleanImageToOneBit(finalImageUrl, state.settings.outputBackground, state.settings.size);
      }

      setSessionTurns(prev =>
        prev.map(t =>
          t.id === turnId
            ? {
                ...t,
                status: 'complete',
                modelOutput: {
                  finalImageUrl: finalImageUrl,
                  responseText: result.text || null,
                  error: null,
                },
              }
            : t
        )
      );
    } catch (error) {
      setSessionTurns(prev =>
        prev.map(t =>
          t.id === turnId
            ? {
                ...t,
                status: 'error',
                modelOutput: { ...t.modelOutput, error: (error as Error).message },
              }
            : t
        )
      );
    } finally {
      setIsGenerating(false);
    }
  }, [candyPhoto, styleTraces, mainPrompt, addLog, state.settings, sandboxSystemInstruction]);
  
  const handleRefinementGenerate = React.useCallback(async () => {
    const currentPrompt = refinementPrompt;
    const currentImage = refinementImage;

    if (!currentPrompt.trim() && !currentImage) {
        return;
    }

    setIsGenerating(true);
    setRefinementPrompt('');
    setRefinementImage(null);

    const turnId = `turn_${Date.now()}`;
    const isDirectMode = apiMode === 'direct';

    let promptForApi = currentPrompt;
    if (state.settings.outputBackground === 'transparent') {
        promptForApi += `\n\n${TRANSPARENT_BACKGROUND_INSTRUCTION}`;
    } else if (state.settings.forceBlankCanvas) {
        promptForApi += `\n\n${BLANK_CANVAS_INSTRUCTION}`;
    }

    const newTurn: SandboxSessionTurn = {
      id: turnId,
      userInput: { text: promptForApi, isInitialPrompt: isDirectMode },
      modelOutput: { finalImageUrl: null, responseText: null, error: null },
      status: 'pending',
    };
  
    setSessionTurns(prev => [...prev, newTurn]);
  
    try {
        const conversationForApi: GeminiTurn[] = [];

        if (!isDirectMode) {
            for (const turn of sessionTurns) {
                if (turn.id === turnId) break;
                if (turn.status !== 'complete') continue;

                const userParts: GeminiTurn['parts'] = [];
                if (turn.userInput.isInitialPrompt) {
                    if (!candyPhoto) throw new Error("Logic Error: Candy photo missing for initial turn.");
                    const images: File[] = [candyPhoto, ...styleTraces];
                    const imageParts = await Promise.all(images.map(f => getApiImageParts(f).then(({data, mimeType}) => ({inlineData: {data, mimeType}}))));
                    userParts.push(...imageParts);
                }
                userParts.push({ text: turn.userInput.text });
                conversationForApi.push({ role: 'user', parts: userParts });

                const modelParts: GeminiTurn['parts'] = [];
                if (turn.modelOutput.finalImageUrl) {
                    const file = await dataUrlToFile(turn.modelOutput.finalImageUrl, 'model-output.png');
                    const { data, mimeType } = await getApiImageParts(file);
                    modelParts.push({ inlineData: { data, mimeType } });
                }
                if (turn.modelOutput.responseText) {
                    modelParts.push({ text: turn.modelOutput.responseText });
                }
                if (modelParts.length > 0) {
                    conversationForApi.push({ role: 'model', parts: modelParts });
                }
            }
        }

        const currentUserParts: GeminiTurn['parts'] = [];

        if (isDirectMode) {
            if (!candyPhoto) throw new Error("Candy photo is required for Direct Mode.");
            const images: File[] = [candyPhoto, ...styleTraces];
            const imageParts = await Promise.all(images.map(f => getApiImageParts(f).then(({data, mimeType}) => ({inlineData: {data, mimeType}}))));
            currentUserParts.push(...imageParts);
        }
        
        if (currentImage) {
            const { data, mimeType } = await getApiImageParts(currentImage);
            currentUserParts.push({ inlineData: { data, mimeType } });
        }
        if (currentPrompt.trim()) {
            currentUserParts.push({ text: promptForApi });
        }
        conversationForApi.push({ role: 'user', parts: currentUserParts });
      
        const systemInstruction = state.settings.systemInstructionEnabled ? sandboxSystemInstruction : null;
        const result = await geminiService.generateImageFromMultiModal(conversationForApi, systemInstruction);
        
        let finalImageUrl = result.imageUrl || null;
        if (finalImageUrl && state.settings.autoCleanTrace) {
            finalImageUrl = await cleanImageToOneBit(finalImageUrl, state.settings.outputBackground, state.settings.size);
        }
  
        setSessionTurns(prev =>
            prev.map(t =>
                t.id === turnId
                ? {
                    ...t,
                    status: 'complete',
                    modelOutput: {
                        ...t.modelOutput,
                        finalImageUrl: finalImageUrl,
                        responseText: result.text || null,
                    },
                    }
                : t
            )
        );
    } catch (error) {
        setSessionTurns(prev =>
            prev.map(t =>
            t.id === turnId
                ? {
                    ...t,
                    status: 'error',
                    modelOutput: { ...t.modelOutput, error: (error as Error).message },
                }
                : t
            )
        );
    } finally {
        setIsGenerating(false);
    }
  }, [sessionTurns, refinementPrompt, refinementImage, state.settings, candyPhoto, styleTraces, sandboxSystemInstruction, apiMode, addLog]);

  const handleSaveAndActivate = () => {
        const versionName = window.prompt("Enter a name for this new prompt version:");
        if (!versionName || !versionName.trim()) {
            addLog('WARN', 'Save cancelled. A version name is required.');
            return;
        }

        const newVersion: PromptVersion = {
            id: `prompt_${Date.now()}`,
            timestamp: Date.now(),
            name: versionName.trim(),
            content: mainPrompt,
        };

        // Fix: Updated logic to save prompts to the correct history ('simpleTraceMainPromptHistory' or 'dynamicSimpleTraceMainPromptHistory').
        let promptHistoryKey: PromptHistoryKey;
        let activePromptIdKey: keyof Settings;

        switch (targetPromptSet) {
            case 'simpleTrace':
                // Fix: Corrected assignment to match the expanded PromptHistoryKey type.
                promptHistoryKey = 'simpleTraceMainPromptHistory';
                activePromptIdKey = 'activeSimpleTraceMainPromptId';
                break;
            case 'dynamicSimpleTrace':
            default:
                // Fix: Corrected assignment to match the expanded PromptHistoryKey type.
                promptHistoryKey = 'dynamicSimpleTraceMainPromptHistory';
                activePromptIdKey = 'activeDynamicSimpleTraceMainPromptId';
                break;
        }

        // 1. Add new prompt version to history
        dispatch({
            type: 'ADD_PROMPT_VERSION',
            payload: { promptKey: promptHistoryKey, version: newVersion }
        });

        // 2. Update settings to use new prompt and system instruction
        dispatch({
            type: 'UPDATE_SETTINGS',
            payload: {
                systemInstruction: sandboxSystemInstruction,
                [activePromptIdKey]: newVersion.id,
                activePromptSet: targetPromptSet // Also make this the active set
            }
        });

        addLog('SUCCESS', `Prompt version '${versionName}' saved and activated system-wide.`);
    };

  // --- Save to Trace Library Logic ---
  const handleOpenSaveModal = (turn: SandboxSessionTurn) => {
    setSaveTraceName(candyPhoto?.name.replace(/\.[^/.]+$/, '') || `sandbox-trace-${Date.now()}`);
    setSaveTraceSide('A');
    setSaveModalState({ isOpen: true, turn });
  };

  const handleCloseSaveModal = () => {
    setSaveModalState({ isOpen: false, turn: null });
  };

  const handleConfirmSaveTrace = async () => {
    const { turn } = saveModalState;
    if (!turn || !candyPhoto || !turn.modelOutput.finalImageUrl || !saveTraceName.trim()) {
        addLog('ERROR', 'Missing data to save trace. Ensure a candy photo is present and the trace has a name.');
        return;
    }

    addLog('INFO', `Saving trace '${saveTraceName}' to library...`);

    try {
        const traceImageFile = await dataUrlToFile(turn.modelOutput.finalImageUrl, `${saveTraceName}_trace.png`);
        
        const styleSetIds: string[] = [];
        for (const traceFile of styleTraces) {
            const foundSet = state.styleSets.find(ss =>
                (ss.A.traceFile?.name === traceFile.name && ss.A.traceFile?.size === traceFile.size) ||
                (ss.B.traceFile?.name === traceFile.name && ss.B.traceFile?.size === traceFile.size)
            );
            if (foundSet) {
                styleSetIds.push(foundSet.id);
            } else {
                styleSetIds.push(traceFile.name); // Fallback to filename if not found
            }
        }

        const promptName = selectedPromptSet === 'custom' ? 'Custom Sandbox Prompt' : `Sandbox (${promptSetOptions[targetPromptSet]} Set)`;

        const newTrace: UnsavedTrace = {
            id: `sandbox-${Date.now()}`,
            timestamp: Date.now(),
            candyName: saveTraceName.trim(),
            side: saveTraceSide,
            traceImageFile: traceImageFile,
            candyImageFile: candyPhoto,
            prompt: mainPrompt, // Always save the main prompt from the sandbox session
            promptName,
            styleRefIds: styleSetIds,
            origin: 'sandbox',
            systemInstruction: state.settings.systemInstructionEnabled ? sandboxSystemInstruction : undefined,
            bucket: 'Unassigned',
        };

        const storedTrace = await dbService.saveTrace(newTrace);
        dispatch({ type: 'ADD_TO_ARCHIVE', payload: storedTrace });
        addLog('SUCCESS', `Successfully saved '${saveTraceName}' to the Trace Archive.`);
    } catch (error) {
        addLog('ERROR', `Failed to save trace: ${(error as Error).message}`);
    } finally {
        handleCloseSaveModal();
    }
  };


  return (
    <div className="grid grid-cols-12 gap-6 p-6 h-full bg-gray-100 overflow-hidden">
      {/* Column 1: Inputs & Assets */}
      <div className="col-span-12 lg:col-span-3 bg-gray-50 p-4 rounded-lg border border-gray-200 flex flex-col space-y-4 overflow-y-auto">
        <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-gray-800">Inputs & Assets</h2>
            <div className="flex items-center space-x-3">
                <button onClick={handleSaveSession} className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors">Save</button>
                <button onClick={handleLoadSession} className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors">Load</button>
            </div>
        </div>
        
        <DropzoneComponent title="Candy Photo" onDrop={(files) => setCandyPhoto(files[0])} className="h-48" accept={{'image/*':[]}} maxFiles={1}>
          {candyPhoto ? (
            <FileImagePreview file={candyPhoto} alt="Candy" className="max-h-full max-w-full object-contain rounded" />
          ) : (
            <>
              <UploadIcon className="w-8 h-8 mx-auto mb-2 text-gray-400" />
              <p className="text-sm text-gray-500">Drop photo here, or click</p>
            </>
          )}
        </DropzoneComponent>

        <DropzoneComponent title="Style Traces" onDrop={(files) => setStyleTraces(files)} className="min-h-[6rem]" accept={{'image/*':[]}} maxFiles={2}>
           {styleTraces.length > 0 ? (
            <div className="flex items-center justify-center space-x-2 h-full p-2">
              {styleTraces.map((file, index) => (
                <FileImagePreview key={index} file={file} alt={`Style ${index + 1}`} className="max-h-20 object-contain rounded" />
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">Drop style traces here</p>
          )}
        </DropzoneComponent>

        <div className="space-y-2">
            <button onClick={() => setIsCandyPickerOpen(true)} className="w-full text-left bg-white p-3 rounded-lg border hover:border-gray-400 transition-colors text-sm font-medium">Pick from Candy Library</button>
            <button onClick={() => setIsStylePickerOpen(true)} className="w-full text-left bg-white p-3 rounded-lg border hover:border-gray-400 transition-colors text-sm font-medium">Pick from Style Library</button>
        </div>

        <div className="mt-auto pt-4 border-t border-gray-200">
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">API Image Order Preview</h3>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-gray-600">
                <div className="flex flex-col items-center">
                    <div className="w-20 h-20 bg-white rounded border flex items-center justify-center">
                        {candyPhoto ? (
                            <FileImagePreview file={candyPhoto} className="max-w-full max-h-full object-contain" alt="Candy Photo" />
                        ) : (
                            <span className="text-xs p-2 text-gray-400">Not Set</span>
                        )}
                    </div>
                    <p className="text-xs mt-1 font-semibold">[1] Candy Photo</p>
                </div>
                <div className="flex flex-col items-center">
                    <div className="w-20 h-20 bg-white rounded border flex items-center justify-center">
                        {styleTraces[0] ? (
                            <FileImagePreview file={styleTraces[0]} className="max-w-full max-h-full object-contain" alt="Style Ref 1" />
                        ) : (
                            <span className="text-xs p-2 text-gray-400">Not Set</span>
                        )}
                    </div>
                    <p className="text-xs mt-1 font-semibold">[2] Style Ref 1</p>
                </div>
                <div className="flex flex-col items-center">
                    <div className="w-20 h-20 bg-white rounded border flex items-center justify-center">
                        {styleTraces[1] ? (
                            <FileImagePreview file={styleTraces[1]} className="max-w-full max-h-full object-contain" alt="Style Ref 2" />
                        ) : (
                            <span className="text-xs p-2 text-gray-400">Not Set</span>
                        )}
                    </div>
                    <p className="text-xs mt-1 font-semibold">[3] Style Ref 2</p>
                </div>
            </div>
        </div>
      </div>

      {/* Column 2: Prompts & Controls */}
      <div className="col-span-12 lg:col-span-5 bg-gray-50 p-4 rounded-lg border border-gray-200 flex flex-col space-y-4 overflow-y-auto">
        <h2 className="text-xl font-bold text-gray-800">Prompts & Controls</h2>
        
        <div className="bg-white p-3 rounded-lg border">
            <label className="block text-sm font-medium text-gray-700 mb-1">API Mode</label>
            <div className="flex items-center space-x-4">
                <label className="flex items-center text-sm">
                    <input type="radio" value="conversational" checked={apiMode === 'conversational'} onChange={() => setApiMode('conversational')} className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300" />
                    <span className="ml-2">Conversational</span>
                </label>
                <label className="flex items-center text-sm">
                    <input type="radio" value="direct" checked={apiMode === 'direct'} onChange={() => setApiMode('direct')} className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300" />
                    <span className="ml-2">Direct</span>
                </label>
            </div>
            <p className="text-xs text-gray-500 mt-1">
                {apiMode === 'conversational' ? 'Each message refines the previous result.' : 'Each message starts a new generation.'}
            </p>
        </div>

        <div className="bg-white p-3 rounded-lg border flex-grow flex flex-col space-y-3">
            <div className="flex-shrink-0">
                <label htmlFor="systemInstructionTextarea" className="block text-sm font-medium text-gray-700 mb-1">System Instruction</label>
                <textarea
                    id="systemInstructionTextarea"
                    value={sandboxSystemInstruction}
                    onChange={e => setSandboxSystemInstruction(e.target.value)}
                    rows={4}
                    className="w-full rounded-md border-gray-200 shadow-sm sm:text-sm font-mono p-2 resize-y"
                    placeholder="Enter system instruction..."
                />
            </div>
            <div className="flex-grow flex flex-col">
                <div className="flex justify-between items-center mb-1">
                    <label htmlFor="mainPromptTextarea" className="block text-sm font-medium text-gray-700">Main Prompt</label>
                    <select
                        id="promptSetSelector"
                        value={selectedPromptSet}
                        onChange={handlePromptSetChange}
                        className="text-xs rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        aria-label="Select a prompt set"
                    >
                        {/* Fix: Updated options to reflect available prompt sets. */}
                        <option value="custom">Custom Sandbox Prompt</option>
                        <option value="simpleTrace">Simple Trace Set</option>
                        <option value="dynamicSimpleTrace">Dynamic Simple Trace Set</option>
                    </select>
                </div>
                <textarea
                    id="mainPromptTextarea"
                    value={mainPrompt}
                    onChange={handleMainPromptChange}
                    className="w-full flex-grow rounded-md border-gray-200 shadow-sm sm:text-sm font-mono p-2 resize-y"
                    placeholder="Enter main prompt or select a set above..."
                />
            </div>
            <div className="flex-shrink-0 pt-3 border-t">
                <button
                    onClick={handleSaveAndActivate}
                    disabled={!mainPrompt.trim() || !sandboxSystemInstruction.trim()}
                    className="w-full flex items-center justify-center rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                    <ArchiveIcon className="w-5 h-5 mr-2"/>
                    Save & Activate System-Wide
                </button>
                 <p className="text-xs text-gray-500 mt-1 text-center">Saves prompts to the '{promptSetOptions[targetPromptSet]}' set and applies them globally.</p>
            </div>
        </div>
        
        <button onClick={handleInitialGenerate} disabled={isGenerating || !candyPhoto || !mainPrompt.trim()} className="w-full rounded-md bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed">
            {isGenerating && sessionTurns.length > 0 && sessionTurns[sessionTurns.length-1].userInput.isInitialPrompt ? 'Generating...' : 'Generate New Session'}
        </button>
      </div>

      {/* Column 3: Session History */}
      <div className="col-span-12 lg:col-span-4 bg-gray-50 rounded-lg border border-gray-200 flex flex-col overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b">
            <h2 className="text-xl font-bold text-gray-800">Session History</h2>
            <button
                onClick={handleResetSession}
                disabled={sessionTurns.length === 0}
                className="p-1 text-gray-500 rounded-full hover:bg-gray-200 hover:text-blue-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                title="Reset Sandbox Session"
            >
                <RefreshIcon className="w-5 h-5" />
            </button>
        </div>
        
        <div className="flex-grow bg-gray-800 p-4 overflow-y-auto space-y-4">
            {sessionTurns.map(turn => (
                <div key={turn.id}>
                    <div className="p-3 bg-gray-600 rounded-lg text-white">
                        <p className="font-semibold text-sm">You</p>
                        <p className="whitespace-pre-wrap text-sm font-mono">{turn.userInput.text}</p>
                    </div>
                    <div className="mt-2 p-3 bg-gray-700 rounded-lg text-white relative">
                        {turn.status === 'complete' && turn.modelOutput.finalImageUrl && (
                            <button
                                onClick={() => handleOpenSaveModal(turn)}
                                className="absolute top-2 right-2 p-1.5 bg-gray-600 text-gray-300 rounded-full hover:bg-blue-500 hover:text-white transition-colors"
                                title="Save to Trace Library"
                            >
                                <ArchiveIcon className="w-4 h-4" />
                            </button>
                        )}
                        <p className="font-semibold text-sm text-blue-300">Gemini</p>
                        {turn.status === 'pending' && <Spinner className="w-6 h-6 text-blue-400 my-2" title="Generating..." />}
                        {turn.status === 'error' && (
                            <div className="text-red-300 flex items-start mt-1 text-sm">
                                <ErrorIcon className="w-5 h-5 mr-2 mt-0.5 flex-shrink-0" />
                                <p>{turn.modelOutput.error}</p>
                            </div>
                        )}
                        {turn.status === 'complete' && (
                            <div className="mt-2 space-y-3">
                                {turn.modelOutput.finalImageUrl && (
                                    <img src={turn.modelOutput.finalImageUrl} alt="Generated" className="max-w-xs rounded border border-gray-500" />
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

        <div className="p-4 border-t relative bg-white">
            {refinementImage && (
                <div className="absolute left-4 -top-20 p-1 bg-gray-700 border border-gray-500 rounded-lg shadow-lg">
                    <img src={URL.createObjectURL(refinementImage)} alt="Attachment" className="h-16 w-auto rounded" />
                    <button
                        onClick={() => setRefinementImage(null)}
                        className="absolute -top-2 -right-2 bg-red-600 text-white p-0.5 rounded-full hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-white"
                        aria-label="Remove image"
                    >
                        <XIcon className="w-3 h-3" />
                    </button>
                </div>
            )}
            <div className="flex items-center space-x-2">
                <label htmlFor="refinement-image-upload" className={`p-2 rounded-full hover:bg-gray-100 cursor-pointer ${isGenerating || sessionTurns.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <PaperClipIcon className="w-6 h-6 text-gray-500" />
                    <input
                        id="refinement-image-upload"
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={handleImageAttachment}
                        disabled={isGenerating || sessionTurns.length === 0}
                    />
                </label>
                <textarea
                    value={refinementPrompt}
                    onChange={e => setRefinementPrompt(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleRefinementGenerate(); } }}
                    rows={1}
                    className="flex-grow p-2 border rounded-md shadow-sm resize-none disabled:bg-gray-100"
                    placeholder="Refine with a message or image..."
                    disabled={isGenerating || sessionTurns.length === 0}
                />
                <button
                    onClick={handleRefinementGenerate}
                    disabled={isGenerating || sessionTurns.length === 0 || (!refinementPrompt.trim() && !refinementImage)}
                    className="p-3 rounded-full bg-blue-600 text-white disabled:bg-gray-400 transition-colors"
                    aria-label="Send refinement"
                >
                    {isGenerating && sessionTurns.length > 0 && !sessionTurns[sessionTurns.length-1].userInput.isInitialPrompt ? <Spinner className="w-5 h-5" /> : <SendIcon className="w-5 h-5" />}
                </button>
            </div>
        </div>
      </div>
       {isCandyPickerOpen && (
        <CandyPickerModal
          pills={state.pillLibrary}
          onSelect={handleSelectCandy}
          onClose={() => setIsCandyPickerOpen(false)}
        />
      )}
      {isStylePickerOpen && (
        <StylePickerModal
          styleSets={state.styleSets}
          onSelect={handleSelectStyles}
          onClose={() => setIsStylePickerOpen(false)}
        />
      )}
      {saveModalState.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4">
            <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
                <h2 className="text-xl font-bold mb-4">Save to Trace Library</h2>
                <div className="space-y-4">
                    <div>
                        <label htmlFor="traceName" className="block text-sm font-medium text-gray-700">Candy Name</label>
                        <input
                            type="text"
                            id="traceName"
                            value={saveTraceName}
                            onChange={(e) => setSaveTraceName(e.target.value)}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Side</label>
                        <div className="mt-2 flex space-x-4">
                            <label className="flex items-center">
                                <input type="radio" name="side" value="A" checked={saveTraceSide === 'A'} onChange={() => setSaveTraceSide('A')} className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300" />
                                <span className="ml-2 text-sm">Side A</span>
                            </label>
                            <label className="flex items-center">
                                <input type="radio" name="side" value="B" checked={saveTraceSide === 'B'} onChange={() => setSaveTraceSide('B')} className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300" />
                                <span className="ml-2 text-sm">Side B</span>
                            </label>
                        </div>
                    </div>
                </div>
                <div className="mt-6 flex justify-end space-x-3">
                    <button onClick={handleCloseSaveModal} className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">Cancel</button>
                    <button onClick={handleConfirmSaveTrace} className="px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50" disabled={!saveTraceName.trim()}>Save</button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};