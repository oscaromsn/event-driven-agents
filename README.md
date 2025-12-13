# 🦄 ai that works: Event-driven agentic loops

> Stop mutating conversational state in-place—log every user input, tool result, and LLM chunk, then project that event stream into the UI, the prompt, and persistence as independent views.

[Video](https://www.youtube.com/watch?v=_VB9TT1Vus4)

[![Event-driven agentic loops](https://img.youtube.com/vi/_VB9TT1Vus4/0.jpg)](https://www.youtube.com/watch?v=_VB9TT1Vus4)

## Episode Summary

Vaibhav and Anders peel back how SageKit’s chat agent handles real-time approvals, queued follow-ups, and user interrupts without race conditions. The core insight: treat the backend like a game server. Every interaction is an append-only event, and each consumer—LLM loop, UI, persistence—receives a projection that suits its contract. We walk through the architecture, wire up a Bun/Effect-TS prototype, and show how an event log makes queuing, cancellation, and tooling far easier to reason about (and test).

## Why Event-Sourced Agents

- Linear agent loops crumble once you need interrupts, approvals, or queued inputs; events give you a single truth you can replay.
- Different surfaces want different stories: the UI should show pending approvals, while the LLM should never see queued user messages until they are active.
- Testing becomes deterministic—replay the same event log and assert the derived state without standing up the UI or the model.

## Demo Architecture

- **Event bus as the write path.** All services publish or subscribe to the same `EventBus`, making it trivial to fork streams or add instrumentation without rewiring the world.

```16:40:2025-11-05-event-driven-agents/demo/src/services/event-bus.ts
    return {
      publish: (event: Event) =>
        pipe(
          PubSub.publish(pubsub, event),
          Effect.tap(() =>
            Effect.sync(() => console.log('[EventBus]', event.type))
          )
        ),

      subscribe: <E extends Event>(filter: (event: Event) => event is E) =>
        Stream.fromPubSub(pubsub, { scoped: true }).pipe(
          Effect.map(stream => stream.pipe(Stream.filter(filter)))
        ),
```

- **Reducers own domain logic.** The message reducer queues user inputs while streaming and flushes them when the LLM finishes—no shared mutable state, just pure functions reacting to events.

```56:172:2025-11-05-event-driven-agents/demo/src/reducers/messages-reducer.ts
    case 'user_message': {
      if (state.isStreaming || state.streamingMessageIndex !== null) {
        return {
          ...state,
          queuedUserMessages: [
            ...state.queuedUserMessages,
            { id: generateId(), content: event.content, timestamp: event.timestamp }
          ]
        }
      }
      return addMessage(state, {
        id: generateId(),
        role: 'user',
        type: 'text',
        content: event.content,
        timestamp: event.timestamp
      })
    }
```

- **Derived projections keep the UI honest.** The UI layer zips message, command, and interrupt state into a single projection, deciding who can click “approve,” whether to show a spinner, and which messages are queued.

```41:176:2025-11-05-event-driven-agents/demo/src/services/ui-display-state.ts
    const displayStream = Stream.zipLatest(
      messagesState.state.changes,
      Stream.zipLatest(commandState.state.changes, interruptState.state.changes)
    ).pipe(
      Stream.map(([messagesValue, [commandsValue, interruptValue]]) => {
        const uiMessages = messagesValue.messages
          .flatMap(/* convert to UIMessage */)
          .concat(messagesValue.queuedUserMessages.map(/* mark as queued */))
        const actions = {
          canSendMessage: true,
          canApprove: phase === 'awaiting_approval',
          canReject: phase === 'awaiting_approval',
          canInterrupt: phase === 'streaming' || phase === 'executing'
        }
        return { messages: uiMessages, status, approvalPrompt, actions }
      })
    )
```

- **LLM streaming is just another subscriber.** The BAML-powered `LLMService` listens for `llm_response_started`, streams chunks back to the bus, and emits synthetic completion events so other consumers stay in sync.

```20:148:2025-11-05-event-driven-agents/demo/src/services/llm-service.ts
    const llmStarts = yield* eventBus.subscribe(
      (e): e is { type: 'llm_response_started'; streamId: string } =>
        e.type === 'llm_response_started'
    )

    yield* Stream.runForEach(llmStarts, event =>
      Effect.gen(function* () {
        const llmMessages = yield* llmMemoryState.getCurrentMessages
        const bamlStream = b.stream.Chat(bamlMessages, { collector })
        const incrementalStream = Stream.fromAsyncIterable(bamlStream, toError).pipe(/* diff chunks */)
        const result = yield* makeInterruptible(
          Stream.runForEach(incrementalStream, ({ current }) =>
            eventBus.publish({ type: 'llm_text_chunk', streamId: event.streamId, text: current })
          ),
          eventBus
        )
        yield* eventBus.publish({ type: 'llm_response_completed', streamId: event.streamId, usage: currentUsage })
      })
    )
```

- **Prompting stays declarative.** A tiny BAML file defines the chat contract, including ANTML tool calls, while the generated TypeScript client feeds the event loop.

```20:67:2025-11-05-event-driven-agents/demo/baml_src/main.baml
function Chat(
  chatHistory: ChatMessage[]
) -> string {
  client BedrockSonnet
  prompt #"
    You have access to one tool:
    - eval(code: string, description: string)
    ...
    {% for message in chatHistory %}
    {{ _.role(message.role) }}
    {{ message.content }}
    {% endfor %}
  "#
}
```

## Observable Behaviors

The Bun test suite drives the entire system through the event bus—no sleeps, no real LLM. We assert that queued messages flush after streaming, interrupts stop the stream, and approvals gate tool execution.

```36:183:2025-11-05-event-driven-agents/demo/src/__tests__/interrupt-and-queue.test.ts
yield* eventBus.publish({ type: 'user_message', content: 'First message', timestamp: Date.now() })
yield* waitForStreamingStart(messagesState.state)
yield* eventBus.publish({ type: 'user_message', content: 'Queued message 1', timestamp: Date.now() })
const stateWithQueue = yield* waitForQueueSize(messagesState.state, 2)
yield* eventBus.publish({ type: 'interrupt_requested', reason: 'User clicked stop' })
yield* waitForInterruptComplete(interruptState.state)
const afterInterrupt = yield* waitForStreamingStop(messagesState.state)
expect(afterInterrupt.isStreaming).toBe(false)
```

## Running the Demo

```bash
# Install dependencies
cd 2025-11-05-event-driven-agents/demo
bun install

# Start the Effect-TS server (websocket + event loop)
bun run server

# In another terminal, launch the Svelte visualizer
bun run web
```

The `bun run dev` script starts both processes with `concurrently` if you prefer a single command.

### Useful Commands

```bash
# Run the event-driven test suite
bun test

# Type-check the whole project
bun run typecheck
```

## Links

- [Episode Recording](https://www.youtube.com/watch?v=_VB9TT1Vus4)
- [Luma Signup](https://luma.com/event-driven-agents)
- [Source Code](https://github.com/ai-that-works/ai-that-works/tree/main/2025-11-05-event-driven-agents)

## Whiteboards

_Add snapshots from the stream when available._

