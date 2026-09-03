import * as React from 'react';
import type { AppState, View } from '../types';
import { StatCard } from './common';
import { PaletteIcon, BookOpenIcon, XIcon, CogIcon, PackageIcon } from './icons';

const GettingStartedGuide: React.FC<{ setView: (view: View) => void; onDismiss: () => void }> = ({ setView, onDismiss }) => {
    return (
        <div className="bg-blue-50 border-l-4 border-blue-500 rounded-r-lg p-6 mb-8 relative shadow-md">
            <button onClick={onDismiss} className="absolute top-3 right-3 p-1 text-blue-700 hover:bg-blue-100 rounded-full transition-colors">
                <XIcon className="w-5 h-5" />
            </button>
            <div className="flex items-start">
                <BookOpenIcon className="w-10 h-10 text-blue-500 mr-5 flex-shrink-0 mt-1" />
                <div>
                    <h2 className="text-xl font-bold text-blue-900">Welcome to Candy Trace!</h2>
                    <p className="text-blue-800 mt-1">Here's a quick guide to getting your first trace.</p>
                </div>
            </div>
            <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4 text-left">
                <div className="flex items-start">
                    <div className="flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-full bg-blue-500 text-white font-bold mr-4">1</div>
                    <div>
                        <h3 className="font-semibold text-blue-900">Upload Your Candy</h3>
                        <p className="text-sm text-blue-800">Go to the <a href="#" onClick={(e) => { e.preventDefault(); setView('candies'); }} className="font-bold underline hover:text-blue-600">Candy Library</a> to upload the photos you want to trace.</p>
                    </div>
                </div>
                <div className="flex items-start">
                    <div className="flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-full bg-blue-500 text-white font-bold mr-4">2</div>
                    <div>
                        <h3 className="font-semibold text-blue-900">Test Traceability</h3>
                        <p className="text-sm text-blue-800">In the <a href="#" onClick={(e) => { e.preventDefault(); setView('candies'); }} className="font-bold underline hover:text-blue-600">Candy Library</a>, select your candy and run a <strong>Guided Test Trace</strong> to see if the AI can trace it without a style reference.</p>
                    </div>
                </div>
                <div className="flex items-start">
                    <div className="flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-full bg-blue-500 text-white font-bold mr-4">3</div>
                    <div>
                        <h3 className="font-semibold text-blue-900">Process Your Job</h3>
                        <p className="text-sm text-blue-800">
                            If the test looks good, send it to the <a href="#" onClick={(e) => { e.preventDefault(); setView('work'); }} className="font-bold underline hover:text-blue-600">Work Queue</a> to process. For custom styles, upload them in the <a href="#" onClick={(e) => { e.preventDefault(); setView('styles'); }} className="font-bold underline hover:text-blue-600">Style Library</a> first.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

const WorkflowStatusCard = ({ traced, total, inQueue, approved }: { traced: number, total: number, inQueue: number, approved: number }) => {
    const progress = total > 0 ? (traced / total) * 100 : 0;
    return (
        <div className="bg-white p-6 rounded-xl shadow-md border flex flex-col justify-between">
            <div className="flex items-start space-x-4 mb-4">
                <div className="rounded-full p-3 bg-yellow-500">
                    <CogIcon className="w-7 h-7 text-white" />
                </div>
                <div>
                    <p className="text-sm font-medium text-gray-500">Workflow Status</p>
                    <p className="text-3xl font-bold text-gray-800">Overview</p>
                </div>
            </div>

            <div className="space-y-3 text-sm">
                <div>
                    <div className="flex justify-between mb-1">
                        <span className="font-medium text-gray-700">Candy Tracing Progress</span>
                        <span className="text-gray-500">{traced} / {total}</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                        <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${progress}%` }}></div>
                    </div>
                </div>
                <div className="flex justify-between items-center border-t pt-2">
                    <span className="font-medium text-gray-700">Items in Work Queue</span>
                    <span className="font-bold text-yellow-600">{inQueue}</span>
                </div>
                <div className="flex justify-between items-center">
                    <span className="font-medium text-gray-700">Approved Traces</span>
                    <span className="font-bold text-green-600">{approved}</span>
                </div>
            </div>
        </div>
    );
};


export const Dashboard = ({ state, setView }: { state: AppState, setView: (view: View) => void }) => {
    const { pillLibrary, styleSets, workPairs, log, traceArchive } = state;
    const [showGuide, setShowGuide] = React.useState(false);

    React.useEffect(() => {
        const isDismissed = localStorage.getItem('candy-trace-hide-guide') === 'true';
        const isNewUser = pillLibrary.length <= 5 && styleSets.length === 0 && workPairs.length === 0;

        if (!isDismissed && isNewUser) {
            setShowGuide(true);
        }
    }, [pillLibrary, styleSets, workPairs]);

    const handleDismissGuide = () => {
        localStorage.setItem('candy-trace-hide-guide', 'true');
        setShowGuide(false);
    };
    
    const itemsInQueue = workPairs.length;
    const logColors = { INFO: 'text-gray-600', SUCCESS: 'text-green-600', WARN: 'text-yellow-600', ERROR: 'text-red-600' };
    const tracedCount = pillLibrary.filter(p => p.traceStatus === 'Completed').length;
    const approvedCount = traceArchive.filter(t => t.isApproved).length;

    return (
        <div className="max-w-7xl mx-auto space-y-8 p-8">
            {showGuide && <GettingStartedGuide setView={setView} onDismiss={handleDismissGuide} />}
            <div>
                <h1 className="text-4xl font-bold text-gray-800">Dashboard</h1>
                <p className="text-lg text-gray-500 mt-1">Welcome! Here's an overview of your Candy Trace environment.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <StatCard icon={PackageIcon} title="Candies in Library" value={pillLibrary.length} color="bg-blue-500" onClick={() => setView('candies')} />
                <StatCard icon={PaletteIcon} title="Styles Available" value={styleSets.filter(s => s.active).length} color="bg-purple-500" onClick={() => setView('styles')} />
                <WorkflowStatusCard
                    traced={tracedCount}
                    total={pillLibrary.length}
                    inQueue={itemsInQueue}
                    approved={approvedCount}
                />
            </div>
            <div>
                 <h2 className="text-2xl font-bold text-gray-800 border-b pb-2 mb-6">Recent Activity</h2>
                 <div className="bg-white p-4 rounded-xl shadow-md border h-full max-h-96 overflow-y-auto">
                    {log.length > 0 ? (
                         <div className="space-y-3">
                            {log.slice(0, 20).map(l => (
                                <div key={l.id} className={`flex items-start font-mono text-xs ${logColors[l.level]}`}>
                                    <span className="w-20 text-gray-400">{new Date(l.ts).toLocaleTimeString()}</span>
                                    <span className="font-bold w-16">[{l.level}]</span>
                                    <p className="flex-1 whitespace-pre-wrap break-words">{l.message}</p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-500"> No recent activity. </div>
                    )}
                 </div>
            </div>
        </div>
    );
};