import * as React from 'react';
import { useDropzone } from 'react-dropzone';
// Fix: Corrected the fallback for `settings` to use `INITIAL_SETTINGS` from constants.
import { BUCKETS, STANDARD_TEST_TRACE_PROMPT, SIMPLE_TRACE_V2_PROMPT, INITIAL_SETTINGS } from '../constants';
import { geminiService } from '../services/geminiService';
import { dbService } from '../services/dbService';
import { dataUrlToFile, parsePillFilename, getFileSHA256 } from '../utils/fileUtils';
import type { Action, AppState, Pill, PillSide, WorkSide, WorkPair, View, SandboxSessionData, TraceabilityResult, ProcessingJob, Bucket } from '../types';
import { RefreshIcon, TrashIcon, UploadIcon, ChevronDownIcon, ChevronUpIcon, SparklesIcon, InspectIcon, XIcon, Spinner, ListBulletIcon, Squares2X2Icon, DatabaseIcon } from './icons';
import { StatusIcon, FileImagePreview, ActionBar, ActionBarLabel, ActionBarButton, ActionBarIconButton, ActionBarDropdown, ActionBarDivider } from './common';
import { CLASSIFICATION_CACHE } from '../classificationCache';

/**
 * FIX SUMMARY
 * - Added safe fallbacks for `state.pillLibrary` and `state.settings` to prevent null/undefined at first render.
 * - Guarded `useMemo` spread with fallback array to avoid spreading null.
 * - No behavioral changes; only stability improvements against transient nulls during initial hydration.
 */

const API_REQUEST_DELAY_MS = 3000; // Add a safe delay between sequential API calls to avoid rate-limiting.

const TraceabilityTestSection: React.FC<{
  title: string;
  testResult: TraceabilityResult;
  onRunTest: () => void;
  onResetTest: () => void;
  isButtonDisabled: boolean;
}> = ({ title, testResult, onRunTest, onResetTest, isButtonDisabled }) => {
    const canReset = testResult.status === 'verified' || testResult.status === 'failed' || testResult.status === 'error';
    
    return (
      <div className="p-4 bg-gray-50 rounded-lg border space-y-3">
        <div className="flex items-center justify-between">
          <p><strong>{title}</strong></p>
          <div className="flex items-center gap-2">
            {canReset && (
                <button
                  onClick={onResetTest}
                  className="inline-flex items-center rounded-md bg-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-300"
                  title="Reset this test to its initial state"
                >
                  <RefreshIcon className="w-4 h-4 mr-2 -ml-1"/>
                  Reset
                </button>
            )}
            <button
                onClick={onRunTest}
                disabled={isButtonDisabled || testResult.status === 'testing'}
                className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:bg-gray-300"
            >
                {testResult.status === 'testing' 
                ? <Spinner className="w-4 h-4 mr-2 -ml-1" />
                : <SparklesIcon className="w-4 h-4 mr-2 -ml-1"/>
                }
                Run Test & Verify
            </button>
          </div>
        </div>
        <p><strong>Status:</strong> <span className="capitalize">{testResult.status}</span></p>
        {testResult.testError && <p className="text-red-600"><strong>Error:</strong> {testResult.testError}</p>}
        {(testResult.status === 'verified' || testResult.status === 'failed') && (
          <div className="pt-3 border-t">
            <p><strong>Verification Result:</strong> <span className={testResult.status === 'verified' ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>{testResult.failureReason}</span></p>
            {testResult.testImageUrl && (
              <div className="mt-2">
                <p className="text-sm font-medium">Test Trace Result:</p>
                <img src={testResult.testImageUrl} className="mt-1 max-w-xs rounded-lg border bg-white" alt="Test Trace"/>
              </div>
            )}
          </div>
        )}
      </div>
)};

export const CandiesView: React.FC<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
  addLog: (level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR', message: string) => void;
  setView: (view: View) => void;
}> = ({ state, dispatch, addLog, setView }) => {
  // --- SAFE FALLBACKS ---
  const pillLibrary: Pill[] = state?.pillLibrary ?? [];
  // Fix: Use INITIAL_SETTINGS for the settings fallback to ensure correct types.
  const settings = state?.settings ?? INITIAL_SETTINGS;

  const [selectedPillId, setSelectedPillId] = React.useState<string | null>(null);
  const [collapsedBuckets, setCollapsedBuckets] = React.useState<Set<string>>(new Set());
  const analysisControllers = React.useRef(new Map<string, AbortController>());

  const [searchTerm, setSearchTerm] = React.useState('');
  const [filterStatus, setFilterStatus] = React.useState<Pill['traceStatus'] | 'All'>('All');
  const [sortBy, setSortBy] = React.useState<'name' | 'id'>('name');
  const [viewMode, setViewMode] = React.useState<'list' | 'grid'>('list');

  const selectedPill = pillLibrary.find(p => p.id === selectedPillId) || null;
  const selectedPillIds = pillLibrary.filter(p => p.selected).map(p => p.id);

  const pillsToReclassify = pillLibrary.filter(p =>
    selectedPillIds.includes(p.id) &&
    (p.classificationStatus === 'idle' || p.classificationStatus === 'error')
  );

  const pillsToClassifyFromCache = pillLibrary.filter(p =>
    selectedPillIds.includes(p.id) && p.classificationStatus === 'idle'
  );

  const pillsToAnalyze = pillLibrary.filter(p =>
    selectedPillIds.includes(p.id) &&
    (p.qualityAnalysisStatus === 'idle' || p.qualityAnalysisStatus === 'error')
  );

  const goodQualityPillsCount = pillLibrary.filter(p =>
    p.qualityAnalysisStatus === 'analyzed' &&
    (p.qualityAnalysisResult === 'Good' || p.qualityAnalysisResult === 'Uncertain') &&
    p.traceStatus !== 'In Queue'
  ).length;
  
  const getTraceabilityStatus = (pill: Pill): { status: 'testing' | 'verified' | 'failed' | 'idle' } => {
    const tests = [
        pill.traceabilityTestA,
        pill.traceabilityTestB,
        pill.guidedTraceabilityTestA,
        pill.guidedTraceabilityTestB,
    ];

    if (tests.some(t => t.status === 'testing')) {
        return { status: 'testing' };
    }

    if (tests.some(t => t.status === 'failed' || t.status === 'error')) {
        return { status: 'failed' };
    }

    if (tests.some(t => t.status === 'verified')) {
        return { status: 'verified' };
    }

    return { status: 'idle' };
  };

  const filteredAndSortedPills = React.useMemo(() => {
    // Guard against transient null by falling back to []
    let pills = [...(pillLibrary || [])];
    if (searchTerm) {
      pills = pills.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    if (filterStatus !== 'All') {
      pills = pills.filter(p => p.traceStatus === filterStatus);
    }
    if (sortBy === 'name') {
      pills.sort((a, b) => a.name.localeCompare(b.name));
    } else { // 'id' which contains timestamp for "recent"
      pills.sort((a, b) => b.id.localeCompare(a.id));
    }
    return pills;
  }, [pillLibrary, searchTerm, filterStatus, sortBy]);

  const toggleBucket = (bucket: string) => {
    setCollapsedBuckets(prev => {
      const newSet = new Set(prev);
      if (newSet.has(bucket)) newSet.delete(bucket); else newSet.add(bucket);
      return newSet;
    });
  };

  const onDrop = React.useCallback(async (acceptedFiles: File[]) => {
    addLog('INFO', `Processing ${acceptedFiles.length} uploaded candy files.`);
    const pillsMap: Map<string, Partial<Pill>> = new Map();
    const initialTraceabilityResult: TraceabilityResult = { status: 'idle' };

    for (const file of acceptedFiles) {
      const parsed = parsePillFilename(file.name);
      if (!parsed) {
        addLog('WARN', `Skipping file with invalid name format: ${file.name}`);
        continue;
      }
      const { name, side } = parsed;
      if (!pillsMap.has(name)) {
        pillsMap.set(name, {
          id: `pill_${name}_${Date.now()}`,
          name,
          selected: false,
          isDetailsExpanded: false,
          bucket: 'Unassigned',
          classificationStatus: 'idle',
          traceStatus: 'Untraced',
          qualityAnalysisStatus: 'idle',
          traceabilityTestA: initialTraceabilityResult,
          traceabilityTestB: initialTraceabilityResult,
          guidedTraceabilityTestA: initialTraceabilityResult,
          guidedTraceabilityTestB: initialTraceabilityResult,
          A: {},
          B: {},
        });
      }
      const pill = pillsMap.get(name)!;
      const pillSide: PillSide = { originalFile: file };
      if (side === 'A') pill.A = pillSide; else pill.B = pillSide;
    }

    const newPills = Array.from(pillsMap.values()) as Pill[];
    if (newPills.length > 0) {
      dispatch({ type: 'ADD_PILLS', payload: newPills });
      addLog('SUCCESS', `Added ${newPills.length} new candies to the library.`);

      if (settings.autoClassifyOnUpload) {
          for (const pill of newPills) {
            const photoToClassify = pill.A.originalFile || pill.B.originalFile;
            if (photoToClassify && settings.useGeminiClassification) {
              dispatch({ type: 'UPDATE_PILL', payload: { id: pill.id, classificationStatus: 'classifying' } });
              try {
                const { bucket } = await geminiService.classifyObjectShape(
                  photoToClassify,
                  settings.temperatureEnabled ? settings.temperature : undefined,
                  settings.textModel
                );
                dispatch({ type: 'UPDATE_PILL', payload: { id: pill.id, bucket, classificationStatus: 'classified' } });
                addLog('INFO', `Auto-classified '${pill.name}' as '${bucket}'.`);
              } catch (e) {
                const err = e as Error;
                dispatch({ type: 'UPDATE_PILL', payload: { id: pill.id, classificationStatus: 'error', classificationError: err.message } });
                addLog('ERROR', `Failed to auto-classify '${pill.name}': ${err.message}`);
              }
              // Delay to avoid hitting API rate limits during batch uploads.
              if (newPills.indexOf(pill) < newPills.length - 1) {
                await new Promise(resolve => setTimeout(resolve, API_REQUEST_DELAY_MS));
              }
            }
          }
      }
    }
  }, [addLog, dispatch, settings]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'image/*': [] } });

  const handleClassifyFromCache = async () => {
    if (pillsToClassifyFromCache.length === 0) {
        addLog('INFO', 'No selected pills require classification from cache.');
        return;
    }

    addLog('INFO', `Attempting to classify ${pillsToClassifyFromCache.length} pill(s) from cache.`);
    let classifiedCount = 0;

    for (const pill of pillsToClassifyFromCache) {
        const photoToClassify = pill.A.originalFile || pill.B.originalFile;
        if (!photoToClassify) {
            addLog('WARN', `Skipping cache classification for '${pill.name}' as it has no images.`);
            continue;
        }

        try {
            const fileHash = await getFileSHA256(photoToClassify);
            const cachedEntry = CLASSIFICATION_CACHE[fileHash];

            if (cachedEntry) {
                dispatch({
                    type: 'UPDATE_PILL',
                    payload: {
                        id: pill.id,
                        bucket: cachedEntry.bucket,
                        classificationStatus: 'classified',
                        classificationError: undefined
                    }
                });
                addLog('SUCCESS', `[Cache Hit] Classified '${pill.name}' as '${cachedEntry.bucket}'.`);
                classifiedCount++;
            } else {
                addLog('INFO', `[Cache Miss] No entry found for '${pill.name}'.`);
            }
        } catch (e) {
            const err = e as Error;
            addLog('ERROR', `Error during cache classification for '${pill.name}': ${err.message}`);
        }
    }
    if (classifiedCount > 0) {
        addLog('SUCCESS', `Finished cache classification. ${classifiedCount} item(s) updated.`);
    } else {
        addLog('INFO', `Finished cache classification. No items were updated.`);
    }
  };

  const handleReclassify = async () => {
    if (pillsToReclassify.length === 0) {
      addLog('INFO', 'No selected pills require re-classification.');
      return;
    }

    addLog('INFO', `Starting re-classification for ${pillsToReclassify.length} pill(s).`);

    for (const pill of pillsToReclassify) {
      const photoToClassify = pill.A.originalFile || pill.B.originalFile;
      if (!photoToClassify) {
        addLog('WARN', `Skipping re-classification for '${pill.name}' as it has no images.`);
        continue;
      }

      dispatch({ type: 'UPDATE_PILL', payload: { id: pill.id, classificationStatus: 'classifying' } });
      try {
        const { bucket } = await geminiService.classifyObjectShape(
          photoToClassify,
          settings.temperatureEnabled ? settings.temperature : undefined,
          settings.textModel
        );
        dispatch({ type: 'UPDATE_PILL', payload: { id: pill.id, bucket, classificationStatus: 'classified', classificationError: undefined } });
        addLog('SUCCESS', `Successfully re-classified '${pill.name}' as '${bucket}'.`);
      } catch (e) {
        const err = e as Error;
        dispatch({ type: 'UPDATE_PILL', payload: { id: pill.id, classificationStatus: 'error', classificationError: err.message } });
        addLog('ERROR', `Failed to re-classify '${pill.name}': ${err.message}`);
      }
      
      // Delay to avoid hitting API rate limits during batch processing.
      if (pillsToReclassify.indexOf(pill) < pillsToReclassify.length - 1) {
        await new Promise(resolve => setTimeout(resolve, API_REQUEST_DELAY_MS));
      }
    }
  };

  const handleCancelAnalysis = (pillId: string) => {
    const controller = analysisControllers.current.get(pillId);
    if (controller) {
      controller.abort();
      addLog('INFO', `Cancelling quality analysis for pill ID ${pillId}.`);
    }
  };

  const handleAnalyzeQuality = async () => {
    if (pillsToAnalyze.length === 0) {
      addLog('INFO', 'No selected pills require quality analysis.');
      return;
    }

    addLog('INFO', `Starting quality analysis for ${pillsToAnalyze.length} pill(s).`);

    for (const pill of pillsToAnalyze) {
      const photoToAnalyze = pill.A.originalFile || pill.B.originalFile;
      if (!photoToAnalyze) {
        addLog('WARN', `Skipping analysis for '${pill.name}' as it has no images.`);
        dispatch({ type: 'UPDATE_PILL', payload: { id: pill.id, qualityAnalysisStatus: 'error', qualityAnalysisError: 'No image file found.' } });
        continue;
      }

      const controller = new AbortController();
      analysisControllers.current.set(pill.id, controller);

      dispatch({ type: 'UPDATE_PILL', payload: { id: pill.id, qualityAnalysisStatus: 'analyzing', qualityAnalysisError: undefined, qualityAnalysisResult: undefined, qualityAnalysisReasoning: undefined } });
      try {
        const { quality, reasoning } = await geminiService.analyzePillQuality(
          photoToAnalyze,
          settings.temperatureEnabled ? settings.temperature : undefined,
          settings.textModel,
          controller.signal
        );
        dispatch({ type: 'UPDATE_PILL', payload: { id: pill.id, qualityAnalysisStatus: 'analyzed', qualityAnalysisResult: quality, qualityAnalysisReasoning: reasoning } });
        addLog('SUCCESS', `Analyzed '${pill.name}': Quality is ${quality}.`);
      } catch (e) {
        const err = e as Error;
        if ((err as any).name === 'AbortError') {
          dispatch({ type: 'UPDATE_PILL', payload: { id: pill.id, qualityAnalysisStatus: 'idle', qualityAnalysisError: 'Analysis was cancelled by the user.' } });
          addLog('WARN', `Quality analysis for '${pill.name}' was cancelled.`);
        } else {
          dispatch({ type: 'UPDATE_PILL', payload: { id: pill.id, qualityAnalysisStatus: 'error', qualityAnalysisError: err.message } });
          addLog('ERROR', `Failed to analyze '${pill.name}': ${err.message}`);
        }
      } finally {
        analysisControllers.current.delete(pill.id);
      }
      
      // Delay to avoid hitting API rate limits during batch processing.
      if (pillsToAnalyze.indexOf(pill) < pillsToAnalyze.length - 1) {
        await new Promise(resolve => setTimeout(resolve, API_REQUEST_DELAY_MS));
      }
    }
  };

  const handlePerformTestTrace = async (pill: Pill, side: 'A' | 'B', testType: 'standard' | 'guided') => {
    const photoToTest = pill[side].originalFile;
    if (!photoToTest) {
      addLog('ERROR', `Cannot perform test trace for '${pill.name}' Side ${side}: No image found.`);
      return;
    }
    
    let prompt: string;
    let promptName: string;
    const testName = testType === 'standard' ? 'Standard' : 'Guided';

    if (testType === 'standard') {
      prompt = STANDARD_TEST_TRACE_PROMPT;
      promptName = 'Standard Test Trace';
    } else { // 'guided'
      const activePrompt = settings.simpleTraceMainPromptHistory.find(
        p => p.id === settings.activeSimpleTraceMainPromptId
      );
      if (activePrompt) {
        prompt = activePrompt.content;
        promptName = activePrompt.name;
      } else {
        addLog('WARN', 'Could not find active Simple Trace prompt in settings. Falling back to default constant.');
        prompt = SIMPLE_TRACE_V2_PROMPT;
        promptName = 'Simple Trace v2 (Fallback)';
      }
    }

    addLog('INFO', `Performing ${testName} test trace for '${pill.name}' Side ${side}...`);

    const stateKey: keyof Pill = `${testType === 'standard' ? 'traceabilityTest' : 'guidedTraceabilityTest'}${side}` as keyof Pill;

    dispatch({ type: 'UPDATE_PILL', payload: {
      id: pill.id,
      [stateKey]: { status: 'testing', testError: undefined, failureReason: undefined, testImageUrl: undefined }
    }});

    try {
      const startTime = Date.now();
      const result = await geminiService.performAndVerifyTestTrace(
        photoToTest,
        settings.textModel,
        prompt
      );
      const durationMs = Date.now() - startTime;

      dispatch({ type: 'UPDATE_PILL', payload: {
        id: pill.id,
        [stateKey]: {
          status: result.success ? 'verified' : 'failed',
          testImageUrl: result.imageUrl,
          failureReason: result.reason,
        }
      }});
      addLog('SUCCESS', `${testName} test trace for '${pill.name}' Side ${side} complete. Result: ${result.success ? 'Verified' : 'Failed'}.`);

      const traceImageFile = await dataUrlToFile(result.imageUrl, `${pill.name}_${side}_${testType}_test_trace.png`);
      const storedTrace = await dbService.saveTrace({
        id: `test-${pill.id}-${side}-${testType}-${Date.now()}`,
        timestamp: Date.now(),
        candyName: pill.name,
        side: side,
        traceImageFile: traceImageFile,
        candyImageFile: photoToTest,
        prompt: prompt,
        promptName,
        styleRefIds: [],
        durationMs: durationMs,
        systemInstruction: undefined,
        bucket: pill.bucket,
        origin: 'test',
        testType: testType,
      });
      dispatch({ type: 'ADD_TO_ARCHIVE', payload: storedTrace });
      addLog('INFO', `Saved ${testName} test trace for '${pill.name}' to the Trace Archive.`);

      // After a successful test, classify if needed
      if (pill.bucket === 'Unassigned') {
          addLog('INFO', `Test for '${pill.name}' complete. Now performing classification.`);
          dispatch({ type: 'UPDATE_PILL', payload: { id: pill.id, classificationStatus: 'classifying' } });
          try {
              const { bucket } = await geminiService.classifyObjectShape(
                  photoToTest,
                  settings.temperatureEnabled ? settings.temperature : undefined,
                  settings.textModel
              );
              dispatch({ type: 'UPDATE_PILL', payload: { id: pill.id, bucket, classificationStatus: 'classified' } });
              addLog('SUCCESS', `Classified '${pill.name}' as '${bucket}' after test.`);
          } catch (classError) {
              const cErr = classError as Error;
              dispatch({ type: 'UPDATE_PILL', payload: { id: pill.id, classificationStatus: 'error', classificationError: cErr.message } });
              addLog('ERROR', `Post-test classification for '${pill.name}' failed: ${cErr.message}`);
          }
      }

    } catch (e) {
      const err = e as Error;
      dispatch({ type: 'UPDATE_PILL', payload: {
        id: pill.id,
        [stateKey]: { status: 'error', testError: err.message }
      }});
      addLog('ERROR', `${testName} test trace for '${pill.name}' Side ${side} failed: ${err.message}`);
    }
  };

  const handleResetTestTrace = (pill: Pill, side: 'A' | 'B', testType: 'standard' | 'guided') => {
    const stateKey: keyof Pill = `${testType === 'standard' ? 'traceabilityTest' : 'guidedTraceabilityTest'}${side}` as keyof Pill;

    const initialTraceabilityResult: TraceabilityResult = {
        status: 'idle',
        testImageUrl: undefined,
        failureReason: undefined,
        testError: undefined,
    };

    dispatch({
        type: 'UPDATE_PILL',
        payload: {
            id: pill.id,
            [stateKey]: initialTraceabilityResult
        }
    });

    addLog('INFO', `Reset ${testType} test for '${pill.name}' Side ${side}.`);
  };

  const sendToWorkQueue = () => {
    const pillsToSend = pillLibrary.filter(p => selectedPillIds.includes(p.id));
    if (pillsToSend.length === 0) return;

    const workPairs: WorkPair[] = [];
    const jobs: ProcessingJob[] = [];

    pillsToSend.forEach(pill => {
      const createWorkSide = (side: 'A' | 'B'): WorkSide => ({
        originalFile: pill[side].originalFile,
        status: 'queued', // Set directly to queued
        gens: [],
        bucket: pill.bucket,
        classificationStatus: pill.classificationStatus,
        classificationError: pill.classificationError,
        logoExtractionStatus: 'idle',
        styleRefIds: [],
      });
      
      const workPair: WorkPair = {
        id: pill.id,
        name: pill.name,
        selected: false,
        isDetailsExpanded: false,
        sideComparisonStatus: 'idle',
        A: createWorkSide('A'),
        B: createWorkSide('B'),
      };
      workPairs.push(workPair);

      if (workPair.A.originalFile) jobs.push({ workPairId: pill.id, side: 'A' });
      if (workPair.B.originalFile) jobs.push({ workPairId: pill.id, side: 'B' });

      dispatch({ type: 'UPDATE_PILL', payload: { id: pill.id, traceStatus: 'In Queue' } });
    });

    dispatch({ type: 'ADD_WORK_PAIRS', payload: workPairs });
    dispatch({ type: 'SET_PROCESSING_QUEUE', payload: [...state.processingQueue, ...jobs] });
    addLog('SUCCESS', `Sent and queued ${workPairs.length} candies for the Work Queue.`);
  };

  const handleSendGoodQualityToWork = () => {
    const pillsToSend = pillLibrary.filter(p =>
      p.qualityAnalysisStatus === 'analyzed' &&
      (p.qualityAnalysisResult === 'Good' || p.qualityAnalysisResult === 'Uncertain') &&
      p.traceStatus !== 'In Queue'
    );

    if (pillsToSend.length === 0) {
      addLog('INFO', 'No pills with "Good" or "Uncertain" quality are ready to be sent to the work queue.');
      return;
    }

    const workPairs: WorkPair[] = [];
    const jobs: ProcessingJob[] = [];

    pillsToSend.forEach(pill => {
        const createWorkSide = (side: 'A' | 'B'): WorkSide => ({
            originalFile: pill[side].originalFile,
            status: 'queued',
            gens: [],
            bucket: pill.bucket,
            classificationStatus: pill.classificationStatus,
            classificationError: pill.classificationError,
            logoExtractionStatus: 'idle',
            styleRefIds: [],
        });

        const workPair: WorkPair = {
            id: pill.id,
            name: pill.name,
            selected: false,
            isDetailsExpanded: false,
            sideComparisonStatus: 'idle',
            A: createWorkSide('A'),
            B: createWorkSide('B'),
        };
        workPairs.push(workPair);

        if (workPair.A.originalFile) jobs.push({ workPairId: pill.id, side: 'A' });
        if (workPair.B.originalFile) jobs.push({ workPairId: pill.id, side: 'B' });

        dispatch({ type: 'UPDATE_PILL', payload: { id: pill.id, traceStatus: 'In Queue' } });
    });

    dispatch({ type: 'ADD_WORK_PAIRS', payload: workPairs });
    dispatch({ type: 'SET_PROCESSING_QUEUE', payload: [...state.processingQueue, ...jobs] });
    addLog('SUCCESS', `Sent and queued ${workPairs.length} good/uncertain quality candies for the Work Queue.`);
  };

  const handleSendToSandbox = () => {
    if (selectedPillIds.length !== 1) {
      addLog('WARN', 'Please select exactly one candy to send to the Sandbox.');
      return;
    }
    const pill = pillLibrary.find(p => p.id === selectedPillIds[0]);
    if (!pill) {
      addLog('ERROR', 'Could not find the selected pill. This may be an application error.');
      return;
    }

    const photo = pill.A.originalFile || pill.B.originalFile;
    if (!photo) {
      addLog('ERROR', `Cannot send '${pill.name}' to Sandbox, no photo found.`);
      return;
    }

    const sandboxData: SandboxSessionData = {
      candyPhoto: photo,
      styleTraces: [],
      mainPrompt: '',
      systemInstruction: settings.systemInstruction,
      sessionTurns: [],
    };

    dispatch({ type: 'SET_SANDBOX_INITIAL_DATA', payload: sandboxData });
    addLog('SUCCESS', `Sent '${pill.name}' to the Sandbox.`);
    setView('sandbox');
  };

  const handleBatchRunTests = async (testType: 'standard' | 'guided', sides: 'A' | 'B' | 'Both') => {
    const pillsToTest = pillLibrary.filter(p => p.selected);
    if (pillsToTest.length === 0) {
        addLog('INFO', 'No selected pills to run tests on.');
        return;
    }

    const jobs: { pill: Pill; side: 'A' | 'B' }[] = [];
    for (const pill of pillsToTest) {
        if ((sides === 'A' || sides === 'Both') && pill.A.originalFile) {
            jobs.push({ pill, side: 'A' });
        }
        if ((sides === 'B' || sides === 'Both') && pill.B.originalFile) {
            jobs.push({ pill, side: 'B' });
        }
    }

    if (jobs.length === 0) {
        addLog('INFO', `Selected pills have no images on the specified side(s) to test.`);
        return;
    }

    const REQUEST_DELAY_MS = 6000;
    const estimatedTime = (jobs.length * (REQUEST_DELAY_MS / 1000) / 60).toFixed(1);
    const testName = testType === 'standard' ? 'Standard' : 'Guided';
    const sideText = sides === 'Both' ? 'Both Sides' : `Side ${sides}`;

    if (window.confirm(
        `This will run the ${testName} Traceability Test on ${jobs.length} pill side(s) (${sideText}) sequentially. ` +
        `This may take approximately ${estimatedTime} minutes and will incur costs. Continue?`
    )) {
        addLog('INFO', `Starting sequential ${testName} testing for ${jobs.length} pill side(s)...`);

        for (let i = 0; i < jobs.length; i++) {
            const { pill, side } = jobs[i];
            await handlePerformTestTrace(pill, side, testType);
            
            if (i < jobs.length - 1) {
                await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
            }
        }
        addLog('SUCCESS', `Finished sequential ${testName} testing for all selected items.`);
    }
  };

  const testOptions = [
    { value: 'A', label: 'Side A Only' },
    { value: 'B', label: 'Side B Only' },
    { value: 'Both', label: 'Both Sides' }
  ];

  const bucketOptions = BUCKETS.map(b => ({ label: b, value: b }));

  return (
    <div className="flex h-full bg-gray-50">
      <div className="w-[40%] p-4 border-r border-gray-200 flex flex-col">
        <h1 className="text-2xl font-bold mb-4">Pill Library</h1>
        <div {...getRootProps()} className={`p-6 border-2 border-dashed rounded-lg text-center cursor-pointer mb-4 ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}`}>
          <input {...getInputProps()} />
          <UploadIcon className="w-8 h-8 mx-auto text-gray-400 mb-2" />
          <p>Drop pill photos here, or click to select</p>
        </div>
        <div className="mb-4 p-2 bg-gray-100 rounded-md border">
          <div className="flex items-center justify-between gap-4 mb-3">
            <input type="search" placeholder="Search by name..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full sm:w-48 rounded-md border-gray-300 shadow-sm text-sm" />
            <div className="flex items-center gap-2">
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className="rounded-md border-gray-300 shadow-sm text-sm">
                <option value="All">All Statuses</option>
                <option value="Untraced">Untraced</option>
                <option value="In Queue">In Queue</option>
                <option value="Completed">Completed</option>
              </select>
              <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="rounded-md border-gray-300 shadow-sm text-sm">
                <option value="name">Sort by Name</option>
                <option value="id">Sort by Recent</option>
              </select>
              <div className="flex items-center rounded-md shadow-sm bg-white border">
                <button onClick={() => setViewMode('list')} className={`p-1.5 rounded-l-md ${viewMode === 'list' ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}><ListBulletIcon className="w-5 h-5"/></button>
                <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-r-md ${viewMode === 'grid' ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}><Squares2X2Icon className="w-5 h-5"/></button>
              </div>
            </div>
          </div>
        </div>
        <ActionBar>
            <ActionBarLabel>{selectedPillIds.length} of {pillLibrary.length} selected</ActionBarLabel>
            <ActionBarButton variant="text" onClick={() => dispatch({ type: 'SET_PILLS', payload: pillLibrary.map(p => ({ ...p, selected: false })) })} disabled={selectedPillIds.length === 0}>Deselect All</ActionBarButton>
            <ActionBarButton variant="text" onClick={() => dispatch({ type: 'BULK_SELECT_PILLS_BY_STATUS', payload: { status: 'Untraced', select: true }})}>Select Untraced</ActionBarButton>
            <ActionBarDropdown label="Assign to Bucket" options={bucketOptions} onSelect={(bucket) => dispatch({ type: 'BULK_UPDATE_PILLS_BUCKET', payload: { ids: selectedPillIds, bucket: bucket as Bucket }})} disabled={selectedPillIds.length === 0} />
            <ActionBarIconButton icon={TrashIcon} label="Delete Selected" variant="destructive" onClick={() => selectedPillIds.forEach(id => dispatch({ type: 'REMOVE_PILL', payload: id }))} disabled={selectedPillIds.length === 0} />
            <ActionBarDivider />
            <ActionBarButton icon={DatabaseIcon} onClick={handleClassifyFromCache} disabled={pillsToClassifyFromCache.length === 0} count={pillsToClassifyFromCache.length}>Classify from Cache</ActionBarButton>
            <ActionBarButton icon={RefreshIcon} onClick={handleReclassify} disabled={pillsToReclassify.length === 0} count={pillsToReclassify.length}>Re-classify</ActionBarButton>
            <ActionBarButton icon={InspectIcon} onClick={handleAnalyzeQuality} disabled={pillsToAnalyze.length === 0} count={pillsToAnalyze.length}>Analyze Quality</ActionBarButton>
            <ActionBarButton icon={SparklesIcon} onClick={handleSendToSandbox} disabled={selectedPillIds.length !== 1}>To Sandbox</ActionBarButton>
            <ActionBarDropdown label="Run Standard Test" options={testOptions} onSelect={(side) => handleBatchRunTests('standard', side as 'A' | 'B' | 'Both')} disabled={selectedPillIds.length === 0} />
            <ActionBarDropdown label="Run Guided Test" options={testOptions} onSelect={(side) => handleBatchRunTests('guided', side as 'A' | 'B' | 'Both')} disabled={selectedPillIds.length === 0} />
            <ActionBarButton variant="primary" onClick={sendToWorkQueue} disabled={selectedPillIds.length === 0}>Send to Work</ActionBarButton>
            <ActionBarButton variant="primary" onClick={handleSendGoodQualityToWork} disabled={goodQualityPillsCount === 0} count={goodQualityPillsCount}>Send Good Quality</ActionBarButton>
        </ActionBar>
        <div className="flex-grow overflow-y-auto pr-2 mt-4">
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {filteredAndSortedPills.map(pill => {
                const traceability = getTraceabilityStatus(pill);
                return (
                <div key={pill.id} onClick={() => setSelectedPillId(pill.id)} className={`p-2 rounded-lg cursor-pointer relative group ${selectedPillId === pill.id ? 'bg-blue-100 ring-2 ring-blue-500' : 'hover:bg-gray-100'}`}>
                  <input type="checkbox" checked={pill.selected} onChange={(e) => { e.stopPropagation(); dispatch({ type: 'UPDATE_PILL', payload: { id: pill.id, selected: !pill.selected }})}} className="absolute top-2 left-2 z-10 h-4 w-4 rounded border-gray-300 opacity-0 group-hover:opacity-100 checked:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}/>
                  {traceability.status === 'testing' && (
                    <div className="absolute top-2 right-2 z-10 p-1 bg-white/70 rounded-full shadow">
                        <Spinner className="w-4 h-4 text-blue-500" />
                    </div>
                  )}
                  <FileImagePreview file={pill.A.originalFile || pill.B.originalFile} className="w-full h-24 object-cover rounded-md bg-white mb-2" alt={pill.name}/>
                  <p className="font-medium text-xs text-center truncate">{pill.name}</p>
                </div>
              )})}
            </div>
          ) : (
            BUCKETS.map(bucket => {
              const pillsInBucket = filteredAndSortedPills.filter(p => p.bucket === bucket);
              if (pillsInBucket.length === 0) return null;

              const selectedInBucketCount = pillsInBucket.filter(p => p.selected).length;
              const allSelected = pillsInBucket.length > 0 && selectedInBucketCount === pillsInBucket.length;
              const someSelected = selectedInBucketCount > 0 && !allSelected;
              const isCollapsed = collapsedBuckets.has(bucket);

              return (
                <div key={bucket}>
                  <div className="flex items-center justify-between my-2 sticky top-0 bg-gray-50 py-1 px-1 rounded">
                    <div className="flex items-center gap-x-2">
                      <input type="checkbox" title={`Select all in ${bucket}`} ref={el => { if (el) (el as any).indeterminate = someSelected; }} checked={allSelected} onChange={() => dispatch({ type: 'BULK_SELECT_PILLS_IN_BUCKET', payload: { bucket, select: !allSelected } })} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"/>
                      <button className="flex-grow text-left" onClick={() => toggleBucket(bucket)}>
                        <h3 className="text-lg font-semibold">{bucket} ({pillsInBucket.length})</h3>
                      </button>
                    </div>
                    <button onClick={() => toggleBucket(bucket)} className="p-1 rounded-full hover:bg-gray-200">
                      {isCollapsed ? <ChevronDownIcon className="w-5 h-5" /> : <ChevronUpIcon className="w-5 h-5" />}
                    </button>
                  </div>

                  {!isCollapsed && pillsInBucket.map(pill => {
                    const traceability = getTraceabilityStatus(pill);
                    return (
                    <div key={pill.id} onClick={() => setSelectedPillId(pill.id)} className={`flex items-center p-2 rounded-md cursor-pointer mb-1 ${selectedPillId === pill.id ? 'bg-blue-100' : 'hover:bg-gray-100'}`}>
                      <input type="checkbox" checked={pill.selected} onChange={(e) => { e.stopPropagation(); dispatch({ type: 'UPDATE_PILL', payload: { id: pill.id, selected: !pill.selected }})}} className="mr-3 h-4 w-4 rounded border-gray-300"/>
                      <FileImagePreview file={pill.A.originalFile || pill.B.originalFile} className="w-12 h-12 object-cover rounded-md mr-3 bg-white" alt={pill.name}/>
                      <div className="flex-grow">
                        <p className="font-medium">{pill.name}</p>
                        <div className="flex items-center space-x-1 mt-1">
                          <p className="text-sm text-gray-500 capitalize">{pill.classificationStatus}</p>
                          {pill.qualityAnalysisResult && <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${ pill.qualityAnalysisResult === 'Good' ? 'bg-green-100 text-green-800' : pill.qualityAnalysisResult === 'Poor' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800' }`}>{pill.qualityAnalysisResult}</span>}
                          {traceability.status === 'testing' && (
                              <span className="inline-flex items-center text-xs font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800">
                                  <Spinner className="w-3 h-3 mr-1" />
                                  Testing
                              </span>
                          )}
                          {traceability.status === 'verified' && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-800">Verified</span>}
                          {traceability.status === 'failed' && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-800">Failed</span>}
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {pill.qualityAnalysisStatus === 'analyzing' ? (
                          <div className="flex items-center space-x-1">
                            <Spinner className="w-5 h-5 text-blue-500" />
                            <button onClick={(e) => { e.stopPropagation(); handleCancelAnalysis(pill.id); }} className="p-1 rounded-full hover:bg-red-100" title="Cancel Analysis">
                              <XIcon className="w-4 h-4 text-red-600" />
                            </button>
                          </div>
                        ) : (
                          <StatusIcon status={pill.qualityAnalysisStatus} error={pill.qualityAnalysisError} />
                        )}
                        <StatusIcon status={pill.classificationStatus} error={pill.classificationError} />
                      </div>
                    </div>
                  )})}
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className="w-[60%] p-6 bg-white overflow-y-auto">
        {selectedPill ? (
          <div className="space-y-6">
            <div className="flex justify-between items-start">
              <input type="text" value={selectedPill.name} onChange={e => dispatch({type: 'UPDATE_PILL', payload: {id: selectedPill.id, name: e.target.value}})} className="text-3xl font-bold border-b-2 border-transparent focus:border-blue-500 outline-none"/>
              <button onClick={() => dispatch({ type: 'REMOVE_PILL', payload: selectedPill.id })} className="p-2 text-gray-500 hover:text-red-600"><TrashIcon className="w-6 h-6"/></button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Side A Column */}
              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold mb-2">Side A Photo</h4>
                  <FileImagePreview file={selectedPill.A.originalFile} className="rounded-lg w-full bg-white border" alt="Side A Photo"/>
                </div>
                <div>
                  <h4 className="font-semibold mb-2">Side A Traceability</h4>
                  {selectedPill.A.originalFile ? (
                    <div className="space-y-4">
                      <TraceabilityTestSection title="Standard Test" testResult={selectedPill.traceabilityTestA} onRunTest={() => handlePerformTestTrace(selectedPill, 'A', 'standard')} onResetTest={() => handleResetTestTrace(selectedPill, 'A', 'standard')} isButtonDisabled={!selectedPill.A.originalFile} />
                      <TraceabilityTestSection title="Guided Test" testResult={selectedPill.guidedTraceabilityTestA} onRunTest={() => handlePerformTestTrace(selectedPill, 'A', 'guided')} onResetTest={() => handleResetTestTrace(selectedPill, 'A', 'guided')} isButtonDisabled={!selectedPill.A.originalFile} />
                    </div>
                  ) : <p className="text-sm text-gray-500">No image for Side A.</p>}
                </div>
              </div>

              {/* Side B Column */}
              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold mb-2">Side B Photo</h4>
                  <FileImagePreview file={selectedPill.B.originalFile} className="rounded-lg w-full bg-white border" alt="Side B Photo"/>
                </div>
                <div>
                  <h4 className="font-semibold mb-2">Side B Traceability</h4>
                  {selectedPill.B.originalFile ? (
                    <div className="space-y-4">
                      <TraceabilityTestSection title="Standard Test" testResult={selectedPill.traceabilityTestB} onRunTest={() => handlePerformTestTrace(selectedPill, 'B', 'standard')} onResetTest={() => handleResetTestTrace(selectedPill, 'B', 'standard')} isButtonDisabled={!selectedPill.B.originalFile} />
                      <TraceabilityTestSection title="Guided Test" testResult={selectedPill.guidedTraceabilityTestB} onRunTest={() => handlePerformTestTrace(selectedPill, 'B', 'guided')} onResetTest={() => handleResetTestTrace(selectedPill, 'B', 'guided')} isButtonDisabled={!selectedPill.B.originalFile} />
                    </div>
                  ) : <p className="text-sm text-gray-500">No image for Side B.</p>}
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-2">Details</h4>
              <div className="p-4 bg-gray-50 rounded-lg border space-y-2">
                <p><strong>Bucket:</strong> {selectedPill.bucket}</p>
                <p><strong>Classification:</strong> {selectedPill.classificationStatus}</p>
                {selectedPill.classificationError && <p className="text-red-600"><strong>Error:</strong> {selectedPill.classificationError}</p>}
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-2">Quality Analysis</h4>
              <div className="p-4 bg-gray-50 rounded-lg border space-y-2">
                <div className="flex justify-between items-center">
                  <p><strong>Status:</strong> <span className="capitalize">{selectedPill.qualityAnalysisStatus}</span></p>
                  {selectedPill.qualityAnalysisStatus === 'analyzing' && (
                    <button onClick={() => handleCancelAnalysis(selectedPill.id)} className="inline-flex items-center rounded-md bg-red-100 px-3 py-1.5 text-sm font-semibold text-red-700 shadow-sm hover:bg-red-200">
                      <XIcon className="w-4 h-4 mr-2 -ml-1" /> Cancel
                    </button>
                  )}
                </div>
                {selectedPill.qualityAnalysisResult && <p><strong>Result:</strong> {selectedPill.qualityAnalysisResult}</p>}
                {selectedPill.qualityAnalysisReasoning && <p><strong>Reasoning:</strong> {selectedPill.qualityAnalysisReasoning}</p>}
                {selectedPill.qualityAnalysisError && <p className="text-red-600"><strong>Error:</strong> {selectedPill.qualityAnalysisError}</p>}
              </div>
            </div>

          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <p>Select a pill from the list to see its details.</p>
          </div>
        )}
      </div>
    </div>
  );
};