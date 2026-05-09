# Notice Command Design Specification

**Date**: 2026-05-09
**Topic**: `taac2026 train notice` — Training task completion notification via WeChat (PushPlus)

## Overview

Add a `notice` subcommand under `train` that monitors a training task and sends a WeChat notification via PushPlus when the task reaches a terminal status (success, failure, killed, canceled).

## Architecture

### Command Structure

```
taac2026 train notice --task-id <id>     # Register notification + auto-start daemon
taac2026 train _notice-watch              # Internal command: poll + notify
```

`notice` is registered under the `train` command group for consistency with existing patterns (`train list`, `train describe`, etc). `_notice-watch` is a hidden internal command (not shown in help).

Users run `taac2026 train notice --task-id xxx` to register. The CLI then:
1. Resolves the task ID to internalId via `jobs.json` (created by `train list`)
2. Appends subscription to `.taac2026/notice.json`
3. Forks a daemon process running `_notice-watch`
4. Exits with a confirmation message

### Data Flow

```
taac2026 train notice --task-id <id>
  → register.ts: resolve internalId from jobs.json → validate → append to notice.json
  → fork: taac2026 train _notice-watch
    → watch.ts: read notice.json → poll every 20 min
    → On terminal status: call PushPlus API → mark subscription completed
    → All subscriptions done → clean completed entries → exit
```

## Components

### New Files

| File | Responsibility |
|------|---------------|
| `src/cli/commands/train/notice.ts` | Register `train notice` command (follows existing flat subcommand pattern) |
| `src/cli/commands/train/notice-watch.ts` | Internal `_notice-watch` command: polling loop + notification |
| `src/api/notification.ts` | PushPlus WeChat notification API wrapper |
| `src/utils/job-status.ts` | Shared `isTerminalJob()` utility (extracted from `train/list.ts`) |

### Existing Files Modified

| File | Change |
|------|--------|
| `src/cli/commands/train/index.ts` | Register `notice` and `_notice-watch` commands |
| `src/cli/commands/train/list.ts` | Extract `isTerminalJob()` → `src/utils/job-status.ts`, import from there |

### Subscription Storage (`.taac2026/notice.json`)

```json
{
  "notices": [
    {
      "id": "uuid-v4",
      "taskId": "angel_training_ams_xxx",
      "internalId": "12345",
      "registeredAt": "2026-05-09T12:00:00.000Z",
      "status": "active"
    }
  ]
}
```

- File created on first use, treated as empty list if missing
- `status`: `active` → `completed` (task finished) or `failed` (3 consecutive API errors)
- Completed/failed entries are auto-removed when the daemon exits

### Task ID Resolution

The Taiji API requires a numeric `internalId` for job detail queries. The `train notice` command resolves this from `jobs.json` (created by running `train list` first), following the same pattern as `train describe`. If the task ID is not found in `jobs.json`, registration fails with a helpful error message suggesting the user run `train list` first.

### Daemon Implementation

- Launched via `child_process.spawn(process.execPath, [...], { detached: true, stdio: 'ignore' })`
- Parent process waits briefly for daemon to write a PID file (`.taac2026/notice.pid`), confirms success or reports fork failure
- Daemon uses `setInterval` with 20-minute polling interval (hardcoded, sufficient for training tasks which run for hours)
- Exits when all subscriptions are completed/failed; auto-removes completed entries from `notice.json`
- UUID generated via Node.js built-in `crypto.randomUUID()`

### PushPlus Integration

- **Endpoint**: `POST http://www.pushplus.plus/send`
- **Token**: Stored in `.taac2026/pushplus-token.txt` following the same pattern as `taiji-cookie.txt`
- **Message format**:
  - `title`: "TAAC2026 训练任务完成通知"
  - `content`: Markdown text with task ID, final status, completion time
- **Template**: "训练任务 {taskId} 已完成，最终状态: {status}，完成时间: {time}"
- Token file is created automatically on first use with a placeholder, user fills in their actual token

### Terminal Status Detection

Uses shared `isTerminalJob()` from `src/utils/job-status.ts` (extracted from `train/list.ts`):
- `jzStatus === "END"`, OR
- `status` in: `SUCCEED`, `FAILED`, `KILLED`, `CANCELED`, `CANCELLED`

## Error Handling

1. **Task ID not found in jobs.json**: Reject registration with message suggesting `train list` first
2. **Poll API failure**: Log warning, retry up to 3 consecutive failures before marking subscription as `failed`
3. **PushPlus failure**: Log error, retry up to 2 times
4. **notice.json corruption**: Treat as empty list, do not crash
5. **Already completed task**: Check status on registration; if terminal, send notification immediately without starting daemon
6. **Daemon fork failure**: Parent process reports error with suggestion to run manually

## Edge Cases

- **Duplicate subscriptions**: Allowed, each polls independently (separate daemon per `notice` call)
- **Daemon crash**: User re-runs `taac2026 train notice` to re-register
- **Multiple active subscriptions in same daemon**: All polled in same interval batch
- **CLI exits before daemon forked**: User simply re-runs the command
- **notice.json grows with old entries**: Completed entries auto-removed when daemon exits

## Dependencies

- No new npm packages needed — PushPlus uses standard `fetch` (already used by the API client)
- PushPlus token stored in `.taac2026/pushplus-token.txt` (user provides their own token)
