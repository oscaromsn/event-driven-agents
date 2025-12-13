# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
bun install

# Development (runs both server and web concurrently)
bun run dev

# Run backend server only (WebSocket + Effect event loop)
bun run server

# Run Svelte frontend only
bun run web

# Run tests
bun test

# Run a single test file
bun test src/__tests__/minimal-flow.test.ts

# Type checking
bun run typecheck
bun run typecheck:watch

# Regenerate BAML client after editing baml_src/main.baml
bun run baml:generate
```

## Architecture

This is an event-sourced agent system built with Effect-TS. The core principle: every interaction is an append-only event, and each consumer (LLM loop, UI, persistence) receives a projection suited to its contract.

### Event-Driven Flow

```
User Input → EventBus → Services react → State updated via Reducers → UI projection
```

### Key Components

**EventBus** (`src/services/event-bus.ts`)
- Central pub/sub using Effect's PubSub
- All services publish/subscribe to the same bus
- Typed event filtering with `subscribe()` and `subscribeToTypes()`

**Reducers** (`src/reducers/`)
- Pure functions that transform state in response to events
- `messages-reducer.ts`: Handles message history, queuing during streaming, token estimation
- `command-reducer.ts`: Tracks tool execution state (requested → approved → executing → completed)
- `interrupt-reducer.ts`: Manages interrupt state

**State Services** (`src/services/`)
- `MessagesState`: Conversation state with SubscriptionRef
- `CommandState`: Tool execution tracking
- `InterruptState`: Interrupt handling
- `UIDisplayState`: Derived projection combining all states for UI consumption
- `LLMMemoryState`: Formats messages for LLM context

**LLMService** (`src/services/llm-service.ts`)
- Subscribes to `llm_response_started` events
- Streams chunks via BAML to the event bus
- Supports interruption via `makeInterruptible()` utility

### Event Types (`src/events.ts`)

Key events flow:
1. `user_message` → queued if streaming, otherwise added to history
2. `llm_response_started` → starts streaming message
3. `llm_text_chunk` → appends to streaming message
4. `command_requested` → tool call parsed, awaits approval
5. `execution_approved/rejected` → user decision
6. `command_completed/failed` → tool result
7. `interrupt_requested` → stops current operation

### ANTML Parser (`src/antml/`)

Parses Anthropic-style XML tool calls from LLM output:
```xml
<function_calls>
  <invoke name="eval">
    <parameter name="code">console.log('hello')</parameter>
  </invoke>
</function_calls>
```

Tools are defined with Effect Schema for validation (`src/tools.ts`).

### Frontend

- Svelte 5 frontend served via Vite on port 3458
- Connects to WebSocket server on port 3457
- Receives `UIDisplayState` projections for rendering
- Sends user actions (messages, approvals, interrupts)

### Testing Pattern

Tests drive the system through the event bus without real LLM calls:
```typescript
yield* eventBus.publish({ type: 'user_message', content: 'test', timestamp: Date.now() })
yield* waitForStreamingStart(messagesState.state)
```

Use `testLayer()` from `src/__tests__/test-utils.ts` to provide mock services.
Test helpers in `src/__tests__/test-helpers.ts` provide condition-based waiting on SubscriptionRef.
