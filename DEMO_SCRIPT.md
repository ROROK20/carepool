# Carepool demo script (about 1:50)

Six scenes, timed to the silent capture `npm run record` makes (`demo/out/carepool-demo-silent.mp4`, 107 seconds). Record your voice over it, or screen-record yourself following the same steps. At a calm pace (about 2.3 words a second), scenes 1, 2, 3 and 6 run a few seconds longer than the capture gives them (measured 2026-11-20). The easy fix is to add a short still frame where the page is already still (on the home page, on an open quote, on the Lisinopril + Spironolactone pair), never to cut or speed up the capture; with those stills the voiced demo is about 2:00.

Before recording: `npm run setup -- --reset --with-cards`, then `npm run dev`, and open `http://localhost:3300`. The care-circle scene uses Friday 2026-11-20 (`?date=2026-11-20`) so the same tasks show every time. Reset the database before each take: scene 5 changes it.

Only say "my grandmother" or tell a personal story if it is true. Nana Rosa is fictional, and the video should say so if anyone could think otherwise.

## Opening line: swap one in per event

Say it over the first two seconds of scene 1, then continue with "This is Carepool."

| Event | Angle | Opening line |
|---|---|---|
| **Teens Hack Houston (Triple H)** | productivity | "Five medicines, three family members, and one group chat that keeps dropping the ball. Carepool turns looking after Nana into a plan everyone can see." |
| **CSC** | people supporting each other | "Caring for an older relative works best when the whole family shares it. Carepool gives every helper the facts and their share of the work." |
| **Global AI Builder's** | everyday task, health and wellbeing | "For a lot of families, sorting a grandparent's pills and reading labels written for doctors is an everyday job. Carepool makes it clear and shared." |
| **AI for Medicine** | future of care | "In the future of care, AI has to show its sources. Carepool only shows a sentence about a medicine if it can point to the FDA label's exact words." |
| **Arbiter** | general | "Here's an AI app that isn't allowed to make things up: every sentence it shows is checked, word for word, against the FDA label." |
| **GenHacks** | healthcare track | "Families manage a lot of medicines at home, from labels written for professionals. Carepool turns real FDA labels into checked, plain-language cards and a shared care plan." |

## The scenes

### 1. Home (0:00 to 0:13), 13 s

**Screen:** the home page for Nana Rosa; scroll down slowly past the tiles, the pharmacist questions and today's doses.

**Say:** *[opening line]* This is Carepool. Nana Rosa (she's made up for this demo) takes five medicines, and three people help look after her.

### 2. A medicine card (0:13 to 0:40), 27 s

**Screen:** the Lisinopril card. Point at "Your prescription, as you typed it". Click "Label says" on the first sentence, then on a side-effect sentence: the label's own words light up.

**Say:** I typed her medicines exactly as the bottles say. Carepool fetched each one's real FDA label, and Claude wrote these plain sentences. Every sentence has to quote the label. Click one: those are the label's exact words. A checker program, with no AI in it, deletes any sentence whose quote isn't in the label word for word, or that mentions a dose. The only dose on a card is the one you typed.

### 3. Interactions (0:40 to 0:57), 17 s

**Screen:** the Interactions page; stop on Lisinopril + Spironolactone with the quoted label sentence.

**Say:** Interactions are found by code, not by the AI. Lisinopril's label names potassium-sparing diuretics like spironolactone, which is on her list, so Carepool flags it and shows that sentence. Claude only explains it in plain words, and that's checked too. It's a question for the pharmacist.

### 4. Schedule (0:57 to 1:09), 12 s

**Screen:** the Schedule page, 8:00 AM and 6:00 PM.

**Say:** The daily schedule uses only what you typed. Carepool never picks a dose or a time. If you didn't enter a time, it says so instead of guessing.

### 5. The care circle (1:09 to 1:31), 22 s

**Screen:** Maya's today page: the evening dose check lists the 6 PM doses as typed. Press "I can't today". Switch to Luis: "Someone needs a hand". Press "I'll take it", then "Mark done".

**Say:** Now the family part. Maya has the evening dose check, but she can't make it tonight. One tap, and Luis sees that someone needs a hand. He takes it, and it's done. Everyone gets a today page with just their own jobs.

### 6. How it works (1:31 to 1:47), 16 s

**Screen:** the How it works page: the pipeline, then the measured numbers.

**Say:** And it's measured. On ten common medicines, every quote we kept was found in the real label text, and on hand-checked pairs the interaction finder got five of its six flags right. Carepool: medicine facts you can check, and a family that shares the work.

Check the numbers in scene 6 against the latest `eval/results.md` before you record. If they change, change the words.

## If you have 30 more seconds

Show a removed sentence (mock mode: `CAREPOOL_PROVIDER=mock CAREPOOL_OFFLINE=1 npm run dev`, any card, "sentences removed by the checker") and say: "Here the checker caught a made-up sentence and threw it out." Say that it is mock mode; the red banner shows it.
