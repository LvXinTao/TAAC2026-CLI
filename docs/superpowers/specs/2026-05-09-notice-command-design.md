# Notice Command Design Specification

**Date**: 2026-05-09
**Topic**: `taac2026 notice` — Training task completion notification via WeChat (PushPlus)

## Overview

Add a `notice` subcommand that monitors a training task and sends a WeChat notification via PushPlus when the task reaches a terminal status (success, failure, killed, canceled).

## Architecture

### Command Structure

```
taac2026 notice --task-id <id>           # Register notification + auto-start daemon
taac2026 _notice-watch                    # Internal command: poll + notify
```

Users run `taac2026 notice --task-id xxx` to register. The CLI then:
1. Validates the task ID against the Taiji API
2. Appends subscription to `.taac2026/notice.json`
3. Forks a daemon process running `_notice-watch`
4. Exits with a confirmation message

### Data Flow

```
taac2026 notice --task-id <id>
  → register.ts: validate → append to notice.json
  → fork: taac2026 _notice-watch
    → watch.ts: read notice.json → poll every 20 min
    → On terminal status: call PushPlus API → mark subscription completed
    → All subscriptions done → exit
```

## Components

### New Files

| File | Responsibility |
|------|---------------|
| `src/cli/commands/notice/index.ts` | Register `notice` and `_notice-watch` commands |
| `src/cli/commands/notice/register.ts` | Parameter validation, notice.json write, daemon fork |
| `src/cli/commands/notice/watch.ts` | Polling loop: read subscriptions, query status, trigger notification |
| `src/api/notification.ts` | PushPlus WeChat notification API wrapper |

### Subscription Storage (`.taac2026/notice.json`)

```json
{
  "notices": [
    {
      "id": "uuid-v4",
      "taskId": "angel_training_ams_xxx",
      "registeredAt": "2026-05-09T12:00:00.000Z",
      "status": "active"
    }
  ]
}
```

- File created on first use, treated as empty list if missing
- `status`: `active` → `completed` (task finished) or `failed` (3 consecutive API errors)

### Daemon Implementation

- Launched via `child_process.fork(process.argv[0], [...args], { detached: true })`
- Parent process calls `.unref()` to detach
- Daemon uses `setInterval` with 20-minute polling interval
- Exits when all subscriptions are completed/failed

### PushPlus Integration

- **Endpoint**: `POST http://www.pushplus.plus/send`
- **Channel token**: Built into CLI (environment variable or config constant)
- **Message format**:
  - `title`: "TAAC2026 训练任务完成通知"
  - `content`: Markdown text with task ID, final status, completion time
- **Template**: "训练任务 {taskId} 已完成，最终状态: {status}，完成时间: {time}"

### Terminal Status Detection

Reuse existing `isTerminalJob()` logic from `train/list.ts`:
- `jzStatus === "END"`, OR
- `status` in: `SUCCEED`, `FAILED`, `KILLED`, `CANCELED`, `CANCELLED`

## Error Handling

1. **Invalid task ID**: Reject registration immediately with error message
2. **Poll API failure**: Log warning, retry up to 3 consecutive failures before marking subscription as `failed`
3. **PushPlus failure**: Log error, retry up to 2 times
4. **notice.json corruption**: Treat as empty list, do not crash
5. **Already completed task**: Check status on registration; if terminal, send notification immediately without starting daemon

## Edge Cases

- **Duplicate subscriptions**: Allowed, each polls independently
- **Daemon crash**: User re-runs `taac2026 notice` to re-register
- **Multiple active subscriptions**: All polled in same interval batch
- **CLI exits before daemon forked**: User simply re-runs the command

## Dependencies

- No new npm packages needed — PushPlus uses standard `fetch` (already used by the API client)
- PushPlus channel token stored as a constant in `notification.ts` (to be filled in by project owner)
