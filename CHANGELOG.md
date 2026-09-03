# Candy Trace v0.5 Changelog

This update represents a major architectural and feature overhaul, transforming the application from a simple utility into a comprehensive, multi-stage workflow management tool for generating technical line art.

Here is a detailed changelog of all the changes made:

### 🚀 **New Features**

*   **Multi-View Architecture**: The application has been redesigned with a persistent navigation sidebar, providing access to distinct views for each stage of the workflow.
    *   **`App.tsx`**: Reworked to manage and render multiple views (`Dashboard`, `Candies`, `Styles`, `Work`, etc.).
    *   **`components/common.tsx`**: Added `NavItem` component for the new sidebar.
    *   **`types.ts`**: Expanded the `View` type to include all new screens.

*   **Approval Workflow & Library**: A complete system for promoting generated traces to a production-ready status.
    *   **New "Approved Library" View**: A dedicated view (`components/ApprovedLibraryView.tsx`) has been created to display only traces that have been marked as "Approved". This provides a clean, curated space for final assets.
    *   **Approval in Work Queue**: Completed items in the Work Queue now have an "Approve" button. A batch "Approve Selected" action was also added.
    *   **Approval in Trace Archive**: The Trace Archive now features batch "Approve" and "Un-approve" actions, and the details modal for each trace allows toggling its approval status.
    *   **Data & State**: The `StoredTrace` type was updated with an `isApproved` flag, and new reducer actions (`BULK_UPDATE_ARCHIVE_ITEMS_APPROVAL`) were added for efficient state management.

*   **Dashboard**: A new landing page provides a high-level overview of the application's state.
    *   **`components/Dashboard.tsx`**: New component created to display key statistics (library counts, items in queue) and quick action buttons.
    *   **`components/common.tsx`**: Added `StatCard` and `ActionButton` components to support the dashboard layout.

*   **Pill Library**: A new central repository to upload, manage, and classify candy photos before processing.
    *   **`components/CandiesView.tsx`**: New dedicated view for all library functions.
    *   **`types.ts`**: Added `Pill` and `PillSide` types to model candy library items.
    *   **`reducer.ts`**: Implemented new actions and state for managing the pill library (`ADD_PILLS`, `UPDATE_PILL`, etc.).
    *   **`services/dbService.ts`**: Added IndexedDB storage for the pill library.

*   **Work Queue**: A dedicated view to configure, manage, and monitor batch processing jobs.
    *   **`components/WorkView.tsx`**: New dedicated view for the work queue.
    *   **`hooks/useProcessingQueue.ts`**: The core processing logic was implemented here, handling job execution, prompt selection, and API calls.
    *   **Features**: Start/stop processing, auto-match styles, AI-powered side comparison, batch download of results, and a detailed view for each item.

*   **Trace Archive**: A persistent, searchable archive for all generated trace images and their associated metadata.
    *   **`components/TraceLogView.tsx`**: New view to browse, search, and manage archived traces.
    *   **`types.ts`**: Added `StoredTrace` and `UnsavedTrace` types.
    *   **`services/dbService.ts`**: Added `trace-log` object store in IndexedDB and functions to save, retrieve, and delete traces.
    *   **Features**: Bulk selection, batch download (as a structured ZIP with images and metadata), and a detailed modal view for each trace.

*   **Sandbox Mode**: A powerful interactive environment for prompt engineering and single-shot image generation.
    *   **`components/SandboxView.tsx`**: New view with a multi-turn chat interface.
    *   **Features**: Load assets from libraries, attach images to prompts, save/load sandbox sessions, and save successful generations directly to the Trace Archive.
    *   **`types.ts`**: Added `SandboxTurn`, `SandboxSessionData`, and related types.

*   **Settings Presets & Prompt Versioning**:
    *   **`components/SettingsView.tsx`**: Reworked into a tabbed interface. Added a "Presets" tab to save, load, update, and delete different application configurations.
    *   **`components/PromptEditor.tsx`**: New component to manage and create different versions of the AI prompts.
    *   **`types.ts`**: Added `SettingsPreset` and `PromptVersion` types.
    *   **`reducer.ts`**: Implemented actions for managing presets and prompt versions.

*   **Google Cloud Storage (GCS) Sync**:
    *   **`services/gcsService.ts`**: New service to optionally sync all libraries (Pills, Styles), work sessions, and settings to a GCS bucket.
    *   **`components/SettingsView.tsx`**: Added UI under the "Data & Storage" tab to configure and test the GCS connection.

### ♻️ **Refactoring & Improvements**

*   **Unified AI Service**:
    *   **`services/geminiService.ts`**: Refactored to use a single, unified `generateImageFromMultiModal` function for all image generation tasks. This ensures consistency and leverages the conversational capabilities of the `gemini-2.5-flash-image` model. The text-based `analyzeStyleTrace` function was removed as it's no longer needed.

*   **Enhanced Prompt System**:
    *   **`constants.ts`**: The single prompt was replaced with three distinct, user-selectable prompt sets (`DIRECT_SINGLE_STAGE_MAIN_PROMPT`, `DIRECT_REF_TRACE_MAIN_PROMPT`, `DIRECT_REF_TRACE_EXTENDED_MAIN_PROMPT`) and a new `SYSTEM_INSTRUCTION`.
    *   **`hooks/useProcessingQueue.ts`**: Updated to select and use the active prompt set from settings.

*   **Robust API Calls**:
    *   **`services/geminiService.ts`**: Implemented robust retry logic with exponential backoff for all Gemini API calls to handle transient network or server errors, significantly improving reliability. Error handling was also improved to distinguish between retryable and non-retryable failures.

*   **State Management**:
    *   **`reducer.ts`**: Significantly expanded to handle the state for all new features, including bulk update actions for better performance with large selections.
    *   **`types.ts`**: The main `AppState` type was expanded to include `pillLibrary`, `traceArchive`, and new settings. Many types were updated or added to support the new, more complex data models.

*   **Data Persistence**:
    *   **`services/dbService.ts`**: Upgraded the IndexedDB schema (version 4) to include new object stores for the Pill Library and Trace Archive. Added functions for manual state backup/restore and clearing all local data.

*   **UI/UX & Components**:
    *   **`components/common.tsx`**: Created several new reusable components (`BucketSelector`, `StatusIcon`, `TabButton`, etc.) to build the new UI views consistently.
    *   **`components/icons.tsx`**: Added many new icons to support the new UI and actions. Also improved accessibility for `Spinner`, `ErrorIcon`, `CheckIcon`, and `InfoIcon` by adding support for a `title` prop.

*   **File Handling**:
    *   **`utils/fileUtils.ts`**: Added `parsePillFilename` to handle the naming convention for candy photos.
    *   **`utils/imageUtils.ts`**: Added `injectPromptIntoPng` to embed the generation prompt directly into the output PNG's metadata for better traceability.