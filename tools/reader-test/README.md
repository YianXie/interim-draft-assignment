# Reader test

Twenty invented teacher answers to the form's questions, each with the facts a good reader should pull out, and a script that sends them to a local model through Ollama and scores the replies. Invented data only: never put a real teacher's answer in `cases.py`.

- `cases.py`: the 20 answers, the facts expected from each, and the things that must not be listed.
- `prompt_v1.txt` to `prompt_v3.txt`: the three prompts tried with `qwen3.5:9b` on 13 November 2026. Each version got about 14 of 20 answers fully right.
- `results/`: what that model returned for each prompt.

Run it on the machine where Ollama is running, from this folder:

```bash
python3 run.py . qwen3.5:27b prompt_v3.txt
```

The arguments are the folder, the model, the prompt file, the cases module and `twice` or `once` (twice checks the reply is the same on a rerun). The result goes in `results/`.
