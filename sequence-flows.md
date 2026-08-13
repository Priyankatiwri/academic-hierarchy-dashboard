# Sequence Flows

Four flows: creating a task, capturing submissions, browsing the dashboard, and exporting an
audit report. Each names the option it assumes where [design-options.md](design-options.md)
has alternatives — swap the step if you pick a different option there.

## 1. Task creation & distribution

```mermaid
sequenceDiagram
    actor Prof
    participant FE as Dashboard (admin view)
    participant Backend
    participant DB as SQLite

    Prof->>FE: Select Batch, Semester (already navigated context)
    Prof->>FE: Type Subject name (autocomplete against existing, or create new)
    Prof->>FE: Type Task name
    Prof->>FE: Paste Drive submission link
    Prof->>FE: Pick deadline via date/time picker (exact date + time)
    FE->>Backend: Create Task {subject, name, drive_submission_link, deadline_at}
    Backend->>Backend: Extract drive_folder_id from the pasted link
    Backend->>DB: INSERT subject (if new), INSERT task
    DB-->>Backend: task_id
    Backend-->>FE: Task created, shows its Drive link back to the Prof
    Prof->>Prof: Compose email (problem statement + the same Drive link) — outside the system
    Note over Prof: Groups receive the email and create their group_a / group_b / ... subfolder to submit into
```

## 2. Submission capture (recurring sync)

```mermaid
sequenceDiagram
    participant Cron as Scheduler
    participant Backend
    participant Connector as Drive Connector
    participant DriveAPI as Google Drive API
    participant DB as SQLite (append-only)
    actor Prof

    Cron->>Backend: trigger sync
    loop each Task with a Drive folder
        Backend->>Connector: list subfolders of task's Drive folder
        Connector->>DriveAPI: files.list(folderId, mimeType=folder)
        DriveAPI-->>Connector: subfolders (group_a, group_b, ...)
        Connector-->>Backend: group list
        loop each group subfolder
            Backend->>DB: INSERT OR IGNORE group (subject_id, name) — auto-registers on first sight
            Backend->>Connector: list files in group subfolder
            Connector->>DriveAPI: files.list(groupFolderId)
            DriveAPI-->>Connector: file metadata (name, createdTime, webViewLink)
            Connector-->>Backend: file list
            Backend->>Backend: compute label vs deadline_at ± on-time window
            Backend->>Backend: place record: Batch/Semester/Subject/Task/Group + label
            Backend->>DB: INSERT OR IGNORE submission_event (event_key = drive_file_id)
        end
    end
    Backend->>Backend: for tasks past deadline_at + grace
    Backend->>DB: INSERT OR IGNORE Missing marker per known group with no submission
    Prof->>Backend: (optional, any time) upload screenshot evidence for a task
    Backend->>DB: INSERT evidence record (linked to task, optionally group)
```

## 3. Dashboard browsing (cascading dropdowns → sectioned view)

```mermaid
sequenceDiagram
    actor Viewer as Prof / Auditor
    participant FE as Frontend
    participant API as Backend API
    participant DB as SQLite

    Viewer->>FE: select Batch
    FE->>API: GET /api/batches/:id/semesters
    API-->>FE: 4 semesters
    Viewer->>FE: select Semester
    FE->>API: GET /api/semesters/:id/subjects
    API-->>FE: subject list
    Viewer->>FE: select Subject
    FE->>API: GET /api/subjects/:id/tasks
    API-->>FE: task list
    Viewer->>FE: select Task
    FE->>API: GET /api/tasks/:id/submissions
    API->>DB: join submission_events + groups + evidence, latest per group
    DB-->>API: rows with label, file link, evidence link
    API-->>FE: JSON, grouped by label
    FE-->>Viewer: sectioned view — Before / On time / After / Missing, each listing its groups
```

## 4. Audit report export

```mermaid
sequenceDiagram
    actor Prof
    participant FE as Frontend
    participant API as Backend API
    participant DB as SQLite (append-only log)

    Prof->>FE: choose Batch/Semester + date range, click "Export audit report"
    FE->>API: GET /api/reports/audit.csv?batch=&semester=&from=&to=
    API->>DB: query submission_events (unfiltered by "current" — every event in range)
    DB-->>API: rows incl. Before/On time/After/Missing, evidence links
    API-->>FE: CSV (or PDF) download
    Note over Prof: Report reflects history as recorded — unaffected by later Drive changes
```
