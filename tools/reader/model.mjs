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

// ask(system, user): the model's reply text. Throws on a failed call or an answer that is not 200.
export function makeAsk({ host, model, fetch = globalThis.fetch }) {
  return async (system, user) => {
    const res = await fetch(new URL("/api/chat", host), {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        options: { temperature: 0, seed: 1 },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    if (!res.ok) throw new Error(`${host} answered ${res.status}: ${await res.text()}`);
    return (await res.json()).message?.content ?? "";
  };
}
