// This helps use auto generate libraries you can use in the language of
// your choice. You can have multiple generators if you use multiple languages.
// Just ensure that the output_dir is different for each generator.
generator target {
    // Valid values: "python/pydantic", "typescript", "ruby/sorbet", "rest/openapi"
    output_type "typescript"

    // Where the generated code will be saved (relative to baml_src/)
    output_dir "../src"

    // The version of the BAML package you have installed (e.g. same version as your baml-py or @boundaryml/baml).
    // The BAML VSCode extension version should also match this version.
    version "0.209.0"

    // Valid values: "sync", "async"
    // This controls what `b.FunctionName()` will be (sync or async).
    default_client_mode async
}

class ChatMessage {
  role "user" | "assistant"
  content string
}

function Chat(
  chatHistory: ChatMessage[]
) -> string {
  client CustomGPT5
  prompt #"
    {{ _.role("system") }}
    You are a chatbot with the ability to execute code.

    You have access to one tool:
    - eval(code: string, description: string): Evaluates JavaScript code

    When you want to run code, use ANTML format:
    <function_calls>
      <invoke name="eval">
        <parameter name="code">YOUR_CODE_HERE</parameter>
        <parameter name="description">Brief description</parameter>
      </invoke>
    </function_calls>

    Be concise and helpful.

    {% for message in chatHistory %}
    {% if loop.last %}
    {{ _.role(message.role, cache_control={"type": "ephemeral"}) }}
    {% else %}
    {{ _.role(message.role) }}
    {% endif %}
    {{ message.content }}
    {% endfor %}
  "#
}

client<llm> BedrockSonnet {
  provider aws-bedrock
  options {
    model "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
    inference_configuration {
      max_tokens 8192
      temperature 0.7
    }
    additional_model_request_fields {
      stop_sequences ["</function_calls>"]
    }
    allowed_role_metadata ["cache_control"]
  }
}

// Using the new OpenAI Responses API for enhanced formatting
client<llm> CustomGPT5 {
  provider openai-responses
  options {
    model "gpt-5"
    api_key env.OPENAI_API_KEY
  }
}
