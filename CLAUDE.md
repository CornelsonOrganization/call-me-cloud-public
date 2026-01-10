# Call-Me Cloud

A cloud-hosted phone call MCP server that lets Claude call the user for voice conversations.

## MCP Tools

- `initiate_call` - Start a new call with an initial message
- `continue_call` - Send a follow-up message and wait for response
- `speak_to_user` - Speak without waiting for a response
- `end_call` - End the call with a closing message

## When to Call

- Complex decisions that need real-time discussion
- Clarifying ambiguous requirements
- Reporting completion of significant work
- When text would be too slow or cumbersome

## Call Best Practices

1. **Keep messages concise** - Phone audio is harder to follow than text
2. **One topic per message** - Don't overload with multiple questions
3. **Always confirm before hanging up** - Say something like "Is there anything else, or should I hang up?" before using `end_call`. This catches any transcription errors the user may need to correct.
4. **Use continue_call for dialogue** - Don't end prematurely; have a real conversation

## Example Flow

```
initiate_call: "Hey, I finished the security fixes. Want me to walk through what changed?"
[user responds]
continue_call: "Got it. Any other questions about the implementation?"
[user responds]
end_call: "Sounds good. Anything else before I hang up? ... Great, talk to you later!"
```
