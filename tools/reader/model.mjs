// The reader's calls to Ollama's chat API. fetch is passed in so the tests can stand in for the network.
// A redirect is refused, never followed: the answers go only to the address given.

// Resolves when the address answers at all; rejects with one plain line when it cannot be reached.
export async function reach({ host, fetch = globalThis.fetch }) {
  let res;
  try {
    res = await fetch(new URL("/api/tags", host), { redirect: "error" });
  } catch (e) {
    throw new Error(`cannot reach the model at ${host}: ${e.cause?.code ?? e.cause?.message ?? e.message}`);
  }
  if (!res.ok) throw new Error(`cannot reach the model at ${host}: it answered ${res.status}`);
}

// Ollama's own default window (2048 or 4096 tokens) can be shorter than the prompt, a long answer and the reply; Ollama
// then drops the start, which is the prompt, without a word. 8192 holds a long answer with room for its reply.
export const NUM_CTX = 8192;

// ask(system, user, prior): the model's reply text; prior is any later turns, sent after the user's message.
// format ("json", or a JSON schema) asks Ollama to force valid JSON; it is sent only when given, since some models refuse it.
// Throws on a failed call or an answer that is not 200.
export function makeAsk({ host, model, format, fetch = globalThis.fetch }) {
  return async (system, user, prior = []) => {
    const res = await fetch(new URL("/api/chat", host), {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        options: { temperature: 0, seed: 1, num_ctx: NUM_CTX },
        ...(format === undefined ? {} : { format }),
        messages: [{ role: "system", content: system }, { role: "user", content: user }, ...prior],
      }),
    });
    if (!res.ok) throw new Error(`${host} answered ${res.status}: ${await res.text()}`);
    return (await res.json()).message?.content ?? "";
  };
}
