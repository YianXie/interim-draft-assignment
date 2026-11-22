# Making fit.xlsx

`fit.xlsx` is the optional seventh file on Start. It lists what teachers wrote about themselves (a language, a certificate, experience, a skill or a limitation), one fact per row, tied to a course when the teacher tied it to one. The draft uses it only as the last tie-break, and each teacher's panel shows it.

`tools/reader.mjs` writes it. It sends each written answer to a model running in Ollama on your own machine. The page never calls a model, and the reader is never run by the tests. Every row it writes has to be checked by a person before it goes on Start.

## Before you start

1. **The six are final.** The reader reads the same six files you load on Start, and it stops with the page's own problem line if Start would refuse them. Each fit row names a course by its code in `courses.xlsx`. If you change a code after making `fit.xlsx`, Start refuses that row, so make `fit.xlsx` last.
2. **This repository is on the Mac Mini, with Node 24 or newer.** Run `npm ci` once in its folder.
3. **Ollama is installed and running**, from [ollama.com](https://ollama.com). Download the model once (a large download):

   ```bash
   ollama pull qwen3.5:27b
   ```

4. **Keep the real files outside this repository's folder**, for example in `~/interim-real/six`. They must never be committed.

## Run it

From this repository's folder on the Mac Mini:

```bash
node tools/reader.mjs --dir ~/interim-real/six --out ~/interim-real/fit.xlsx --model qwen3.5:27b
```

- `--dir` is the folder with the six. That can be the converter's `--out` folder; its `convert-report.txt` is ignored.
- `--out` is where `fit.xlsx` goes. The reader never overwrites a file: if one is already there, it stops and writes nothing, so a file you have already checked is safe.
- `--model` defaults to `qwen3.5:9b`. Use `qwen3.5:27b` on the Mini: in `reader-test/` it missed none of the expected facts.
- Leave out `--format json` with `qwen3.5:27b`. It made the model drop facts in testing.
- `--host` defaults to Ollama on the same machine (`http://127.0.0.1:11434`). Don't point it at another computer, because the answers would then cross the network.

It shows `answers read 12 of 180` while it works. A large model can take a minute or more per answer, so expect a long run, and keep the Mini awake. When it finishes it prints one line, for example:

```
teachers read 92, rows 214, dropped 9, not read 1
```

- **rows**: the facts written to `fit.xlsx`.
- **dropped**: facts the model gave that failed a check. Either the quote was not word for word in the answer, the course was not one the teacher ranked on that form, or the kind was not one of the five. These are not written.
- **not read**: teachers whose replies could not be read even after a retry. Their answers are still on the Answers sheet, so you can add their facts by hand.
- A line starting `a model call failed` means Ollama itself returned an error. If many answers are not read, check that Ollama is running and has the model, then run again with a new `--out`.

## Check it in Excel

`fit.xlsx` has two sheets:

- **Fit** (the page reads only this one): Email, Course Code, Kind, Fact, Quote.
- **Answers**: every answer the reader sent, read or not, to check against.

For each row on Fit:

- **Wrong or unhelpful**: delete the row.
- **Fact is right but badly worded**: edit Fact. It is what the panel shows.
- **Kind** must be exactly Language, Certificate, Experience, Skill or Limitation.
- **Course Code** is blank for a general fact, or a code from `courses.xlsx`.
- **Something the model missed**: add a row. Quote may be left blank.

The model can miss facts, so read the Answers sheet too, not only the Fit rows.

Then load the six and `fit.xlsx` on Start. If a row is still wrong, Start names the row and the problem.

## Things to know

- Only the "Enhancing Learning or Safety" answers on `round1.xlsx` and `singapore.xlsx` are read. The other written answers and `round2.xlsx` are not.
- A fact is tied to a course only when the model names one of the courses the teacher ranked on that form, spelled exactly as in `courses.xlsx`. If it spells a course differently, that fact is dropped and counted.
- `fit.xlsx` and its Answers sheet hold the teachers' own words. Keep them with the real files, outside this repository.
- Prompt experiments, on invented answers only, are in `reader-test/`.
