<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type {
    UIMessage,
    UIApprovalPrompt,
    UIActions,
    UIStatus,
  } from "../../src/shared-types.ts";
  import EventGraphVisualizer from "./EventGraphVisualizer.svelte";

  let messages = $state<UIMessage[]>([]);
  let input = $state("");
  let ws: WebSocket | null = null;
  let connectionStatus = $state("Connecting...");
  let statusMessage = $state("");
  let approvalPrompt = $state<UIApprovalPrompt | null>(null);
  let actions = $state<UIActions>({
    canSendMessage: false,
    canApprove: false,
    canReject: false,
    canInterrupt: false,
  });

  onMount(() => {
    ws = new WebSocket("ws://localhost:3457/ws");

    ws.onopen = () => {
      connectionStatus = "Connected";
      console.log("Connected to Dataflow POC server");
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("Received:", data);

      // Handle display updates
      if (data.type === "display_update" && data.display) {
        const display = data.display;
        messages = display.messages || [];
        statusMessage = display.status?.message || "";
        approvalPrompt = display.approvalPrompt || null;
        actions = display.actions || {
          canSendMessage: true,
          canApprove: false,
          canReject: false,
          canInterrupt: false,
        };
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      connectionStatus = "Error";
    };

    ws.onclose = () => {
      connectionStatus = "Disconnected";
      console.log("Disconnected from server");
    };
  });

  onDestroy(() => {
    if (ws) {
      ws.close();
    }
  });

  function sendMessage() {
    if (!ws || !input.trim() || !actions.canSendMessage) return;

    ws.send(
      JSON.stringify({
        type: "user_message",
        content: input.trim(),
      }),
    );

    input = "";
  }

  function approveCommand() {
    if (!ws || !approvalPrompt) return;

    ws.send(
      JSON.stringify({
        type: "execution_approved",
        commandId: approvalPrompt.commandId,
      }),
    );
  }

  function rejectCommand() {
    if (!ws || !approvalPrompt) return;

    ws.send(
      JSON.stringify({
        type: "execution_rejected",
        commandId: approvalPrompt.commandId,
        reason: "User rejected",
      }),
    );
  }

  function interrupt() {
    if (!ws) return;

    ws.send(
      JSON.stringify({
        type: "interrupt_requested",
        reason: "User interrupted",
      }),
    );
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }
</script>

<div class="app">
  <div class="chat-panel">
    <div class="header">
      <h1>Dataflow POC</h1>
      <div class="connection-status">Connection: {connectionStatus}</div>
      {#if statusMessage}
        <div class="status">Status: {statusMessage}</div>
      {/if}
    </div>

    <div class="messages">
      {#each messages as msg}
        {#if msg.type === "user_message"}
          <div class="message message-user" class:queued={msg.queued}>
            <div class="role">
              user{#if msg.queued}
                [queued]{/if}
            </div>
            <div class="content">{msg.content}</div>
          </div>
        {:else if msg.type === "assistant_message"}
          <div class="message message-assistant">
            <div class="role">assistant</div>
            <div class="content">
              {msg.content}{#if msg.streaming}<span class="cursor">▋</span>{/if}
            </div>
          </div>
        {:else if msg.type === "tool_result"}
          <div
            class="message message-tool {msg.success
              ? 'message-tool-success'
              : 'message-tool-error'}"
          >
            <div class="role">tool result: {msg.toolName}</div>
            <div class="content">
              <div class="tool-status">
                {msg.success ? "✓ Success" : "✗ Error"}
              </div>
              <pre class="tool-output">{msg.output}</pre>
            </div>
          </div>
        {:else if msg.type === "execution_rejected"}
          <div class="message message-rejected">
            <div class="role">✗ execution rejected</div>
            <div class="content">Code execution was rejected by user</div>
          </div>
        {:else if msg.type === "interrupt"}
          <div class="message message-interrupt">
            <div class="role">⚠ interrupted</div>
            <div class="content">Operation interrupted by user</div>
          </div>
        {/if}
      {/each}
    </div>

    {#if approvalPrompt}
      <div class="approval-prompt">
        <div class="prompt-title">⚠️ Command Approval Required</div>
        {#if approvalPrompt.description}
          <div class="prompt-message">{approvalPrompt.description}</div>
        {/if}
        <pre class="prompt-code">{approvalPrompt.code}</pre>
        <div class="approval-actions">
          <button
            onclick={approveCommand}
            disabled={!actions.canApprove}
            class="approve-btn"
          >
            ✓ Approve
          </button>
          <button
            onclick={rejectCommand}
            disabled={!actions.canReject}
            class="reject-btn"
          >
            ✗ Reject
          </button>
        </div>
      </div>
    {/if}

    <div class="input-area">
      <textarea
        bind:value={input}
        onkeydown={handleKeydown}
        placeholder="Type a message..."
        disabled={!actions.canSendMessage}
      ></textarea>
      <div class="action-buttons">
        <button
          onclick={sendMessage}
          disabled={!input.trim() || !actions.canSendMessage}
        >
          Send
        </button>
        {#if actions.canInterrupt}
          <button onclick={interrupt} class="interrupt-btn"> Stop </button>
        {/if}
      </div>
    </div>
  </div>

  <div class="visualizer-panel">
    <EventGraphVisualizer />
  </div>
</div>

<style>
  .app {
    display: flex;
    flex-direction: row;
    height: 100vh;
    box-sizing: border-box;
  }

  .chat-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    box-sizing: border-box;
    border-right: 2px solid #333;
  }

  .visualizer-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
  }

  .header {
    border-bottom: 2px solid #333;
    padding-bottom: 1rem;
    margin-bottom: 1rem;
  }

  h1 {
    margin: 0 0 0.5rem 0;
    font-size: 1.5rem;
  }

  .connection-status {
    color: #888;
    font-size: 0.9rem;
  }

  .status {
    color: #0ff;
    font-size: 0.9rem;
    margin-top: 0.25rem;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    margin-bottom: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .message {
    padding: 0.75rem;
    border-left: 3px solid #333;
    transition: opacity 0.2s;
  }

  .message.queued {
    opacity: 0.5;
    border-left-style: dashed;
  }

  .message-user {
    border-left-color: #0f0;
  }

  .message-user.queued {
    border-left-color: #0a0;
  }

  .message-assistant {
    border-left-color: #00f;
  }

  .message-tool {
    border-left-color: #888;
    background: #1a1a1a;
  }

  .message-tool-success {
    border-left-color: #0a0;
  }

  .message-tool-error {
    border-left-color: #a00;
  }

  .message-rejected {
    border-left-color: #f00;
    background: #2a1a1a;
  }

  .message-interrupt {
    border-left-color: #f80;
    background: #2a2010;
  }

  .role {
    font-size: 0.9rem;
    color: #888;
    margin-bottom: 0.5rem;
  }

  .tool-status {
    font-size: 0.85rem;
    margin-bottom: 0.5rem;
    font-weight: bold;
  }

  .message-tool-success .tool-status {
    color: #0f0;
  }

  .message-tool-error .tool-status {
    color: #f00;
  }

  .tool-output {
    background: #111;
    border: 1px solid #333;
    padding: 0.5rem;
    margin: 0;
    overflow-x: auto;
    font-family: monospace;
    font-size: 0.9rem;
    color: #ccc;
  }

  .content {
    white-space: pre-wrap;
    position: relative;
  }

  .cursor {
    color: #0ff;
    animation: blink 1s infinite;
  }

  @keyframes blink {
    0%,
    50% {
      opacity: 1;
    }
    51%,
    100% {
      opacity: 0;
    }
  }

  .approval-prompt {
    background: #1a1a1a;
    border: 2px solid #f80;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  .prompt-title {
    color: #f80;
    font-weight: bold;
    margin-bottom: 0.5rem;
  }

  .prompt-message {
    margin-bottom: 0.75rem;
    color: #ccc;
  }

  .prompt-code {
    background: #111;
    border: 1px solid #333;
    padding: 0.75rem;
    margin-bottom: 0.75rem;
    overflow-x: auto;
    color: #0ff;
  }

  .approval-actions {
    display: flex;
    gap: 0.5rem;
  }

  .input-area {
    border-top: 2px solid #333;
    padding-top: 1rem;
  }

  .action-buttons {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  textarea {
    width: 100%;
    background: #111;
    color: #fff;
    border: 1px solid #333;
    padding: 0.5rem;
    font-family: monospace;
    resize: vertical;
    min-height: 60px;
    box-sizing: border-box;
  }

  textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  button {
    background: #222;
    color: #fff;
    border: 1px solid #333;
    padding: 0.5rem 1rem;
    cursor: pointer;
    font-family: monospace;
  }

  button:hover:not(:disabled) {
    background: #333;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .approve-btn {
    background: #163;
    border-color: #0f0;
  }

  .approve-btn:hover:not(:disabled) {
    background: #1a4;
  }

  .reject-btn {
    background: #631;
    border-color: #f00;
  }

  .reject-btn:hover:not(:disabled) {
    background: #841;
  }

  .interrupt-btn {
    background: #641;
    border-color: #f80;
  }

  .interrupt-btn:hover:not(:disabled) {
    background: #852;
  }
</style>
