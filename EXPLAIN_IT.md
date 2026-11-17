# Explain Carepool in two minutes

Learn the ideas, not the words. The walkthrough is about 300 words, two minutes said out loud at a calm pace. The questions after it are the ones judges tend to ask.

## The walkthrough

**What it is.** Carepool helps a family look after an older relative's medicines. You type the medicine list the way it is printed on the bottles. Carepool gives back four things: a plain-language card for each medicine, a list of pairs to ask the pharmacist about, a daily schedule, and a shared to-do list for the family.

**Where the facts come from.** Every medicine sold in the US has an official FDA label, the long leaflet written for doctors. The FDA publishes these labels through a free website API called openFDA. Carepool downloads the label for each medicine and saves a copy on the computer, so the demo works offline and always shows the same label version.

**What the AI does.** Claude reads the label and writes short, simple sentences: what the medicine is for, how to take it, common side effects, warnings. The rule is that every sentence has to come with a quote: words copied exactly from a named part of the label.

**What the code does.** A checker program, with no AI in it, looks up every quote in the label. If the words are not there exactly, the sentence is deleted. It also deletes a sentence that mentions a dose or how often to take it, has a number its quote does not have, or makes two claims from one quote. The AI gets one chance to fix a rejected sentence, then it is gone. So the AI can make a mistake, but the family never sees one that the checker can catch. On every sentence you can click and see the label's own words highlighted.

**Interactions.** This part is all code. For each pair of medicines, Carepool searches one label's interaction and warning sections for the other medicine's name or drug class. If it finds one, it shows that exact sentence. The AI is only allowed to explain a flag in plain words; it cannot make one up.

**The schedule.** Built only from the doses and times you typed. Carepool never picks a dose or a time for you.

**The family part.** Each person gets a "today" page with their jobs. If you can't do yours, you press "I can't today" and someone else can take it.

## Why citations?

AI models sometimes state things that are not true, in a confident voice. With medicine that is the one thing you cannot allow. Instead of asking people to trust the AI, Carepool makes every sentence show its evidence, and a simple program, which cannot make things up, checks the evidence is real. Trust moves from the AI to something anyone can check.

## The deterministic parts and the model parts

| Done by code (same input, same output, every time) | Done by the model (Claude) |
|---|---|
| Finding and saving the FDA label | Writing plain sentences from the label |
| Checking every quote is word for word in the label | Fixing a rejected sentence, once |
| Removing anything with a dose or dosing frequency | Rewording for clarity (re-checked) |
| Finding interaction flags | Explaining a flag in plain words (re-checked) |
| Building the schedule from your entries | |
| The care circle and hand-offs | |

## Numbers you can say

Take these from `eval/results.md` after the latest run; do not round them up.

- On 10 common medicines, every kept sentence's quote was found word for word in the label: 132 of 132 (the eval re-checks this against the raw FDA text, not the app's copy). 12 of 135 drafted sentences failed the first check; 10 were fixed on a second try and the rest removed.
- A second model then judged whether each sentence says what its own quote says: 109 of 132 fully, the other 23 partly (usually an extra detail). None were judged unsupported. That is a model's opinion, which is why the quote is always shown.
- The interaction finder, tested on 10 pairs checked by hand from the label text: 5 of its 6 flags were right, and it found 5 of the 6 real ones. It missed one because the label said "beta-adrenergic antagonists" instead of a phrase it knows, and it raised one false alarm.

## Questions judges ask

**"What if the AI makes something up?"** It can, and sometimes it does on the first try. The checker deletes any sentence whose quote is not really in the label. What the checker cannot do is understand meaning. I measured that separately: about one sentence in six adds a small detail its quote does not state, so the quote is always one click away and you can compare.

**"Is this medical advice?"** No. It shows what the FDA label says, in plainer words, and every screen says to confirm with a pharmacist or doctor. It never tells anyone to start, stop or change a medicine, and never shows a dose that you did not type.

**"Why not just ask a chatbot?"** A chatbot gives you an answer with no way to check it. Carepool gives you the label's own words next to every sentence, and code throws out what does not match. Also, the interaction flags do not come from the AI at all.

**"How do you know the interaction list is right?"** It is not complete, and Carepool says so. I measured it: on 10 hand-checked pairs it got 5 of 6 flags right and found 5 of 6 real interactions. A flag means "ask the pharmacist", not "danger".

**"Where does the data come from, and is it real?"** Real FDA labels from openFDA, saved with their version and date. The family, Nana Rosa, is made up for the demo.

**"What did you build, and what did you reuse?"** I built Carepool new for this hackathon. The citation checker and the way it calls Claude are adapted from my earlier open-source project, Dispute Defender, and the README lists every reused file and what changed. I used Claude Code to help write the code.

**"Does it cost anything to run?"** No API key and no paid service. The FDA API is free, and the AI runs through the Claude Code app already signed in on the computer.

**"What's next?"** Checking that each plain sentence means what its quote says (with pharmacists rating a sample), a bigger hand-checked interaction set, and sharing the family's today pages across phones.
