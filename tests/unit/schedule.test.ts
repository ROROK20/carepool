import { describe, expect, it } from "vitest";
import { buildSchedule, itemsAt, type MedEntry } from "@/lib/schedule/build";
import { formatTime, parseMedLine, parsePastedList, parseTimes } from "@/lib/schedule/parse";

const med = (over: Partial<MedEntry> & { id: string }): MedEntry => ({ name: over.id, dose: "", times: [], notes: "", ...over });

describe("buildSchedule uses only what the family entered", () => {
  it("places each medicine at exactly the times entered, sorted", () => {
    const sched = buildSchedule([
      med({ id: "m", name: "Metformin", dose: "500 mg tablet, 1 tablet twice daily with meals", times: ["18:00", "08:00"] }),
      med({ id: "l", name: "Lisinopril", dose: "10 mg tablet, take 1 tablet by mouth once daily", times: ["08:00"] }),
    ]);
    expect(sched.slots.map((s) => [s.time, s.items.map((i) => i.name)])).toEqual([
      ["08:00", ["Metformin", "Lisinopril"]],
      ["18:00", ["Metformin"]],
    ]);
    expect(sched.slots[0].label).toBe("8:00 AM");
  });

  it("copies every dose string exactly as typed, odd spelling and all", () => {
    const doses = ["10 mg tablet, take 1 tablet by mouth once daily", "1/2 tab (5mg?) ask Dr. Lee", "  25MG  ", "", "½ tablet — see bottle"];
    const meds = doses.map((dose, i) => med({ id: `m${i}`, dose, times: ["09:00"] }));
    const sched = buildSchedule(meds);
    const out = sched.slots.flatMap((s) => s.items.map((i) => i.dose));
    expect(out).toEqual(doses);
    out.forEach((d, i) => expect(Object.is(d, doses[i])).toBe(true));
  });

  it("never invents a time: a medicine with no time goes to 'no time entered'", () => {
    const sched = buildSchedule([med({ id: "w", name: "Warfarin", dose: "5 mg in the evening", times: [] })]);
    expect(sched.slots).toEqual([]);
    expect(sched.unscheduled.map((i) => i.med_id)).toEqual(["w"]);
  });

  it("does not normalize invalid times; it reports them and does not place the medicine there", () => {
    const sched = buildSchedule([med({ id: "x", times: ["8", "25:00", "08:00"] })]);
    expect(sched.slots.map((s) => s.time)).toEqual(["08:00"]);
    expect(sched.invalid.map((i) => i.value)).toEqual(["8", "25:00"]);
  });

  it("the (medicine, time, dose) triples out are exactly the triples in (property test over random entries)", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let round = 0; round < 50; round++) {
      const meds: MedEntry[] = Array.from({ length: 1 + Math.floor(rand() * 8) }, (_, i) => ({
        id: `m${i}`,
        name: `Med${i}`,
        dose: rand() < 0.2 ? "" : `${Math.floor(rand() * 900)} mg ${"x".repeat(Math.floor(rand() * 5))}`,
        times: Array.from({ length: Math.floor(rand() * 4) }, () => `${String(Math.floor(rand() * 24)).padStart(2, "0")}:${rand() < 0.5 ? "00" : "30"}`),
        notes: "",
      }));
      const sched = buildSchedule(meds);
      const outTriples = sched.slots.flatMap((s) => s.items.map((i) => `${i.med_id}|${s.time}|${i.dose}`)).sort();
      const inTriples = meds.flatMap((m) => [...new Set(m.times)].map((t) => `${m.id}|${t}|${m.dose}`)).sort();
      expect(outTriples).toEqual(inTriples);
      const noTime = meds.filter((m) => m.times.length === 0).map((m) => m.id).sort();
      expect(sched.unscheduled.map((i) => i.med_id).sort()).toEqual(noTime);
    }
  });

  it("itemsAt returns the items of one slot", () => {
    const sched = buildSchedule([med({ id: "a", times: ["08:00"] }), med({ id: "b", times: ["18:00"] })]);
    expect(itemsAt(sched, "08:00").map((i) => i.med_id)).toEqual(["a"]);
    expect(itemsAt(sched, "12:00")).toEqual([]);
  });
});

describe("reading pasted lists", () => {
  it("reads only clock times", () => {
    expect(parseTimes("8:00 AM and 6 pm, also 20:30, noon")).toEqual(["08:00", "12:00", "18:00", "20:30"]);
    expect(parseTimes("12am and 12:15 p.m.")).toEqual(["00:00", "12:15"]);
    expect(parseTimes("every morning, twice daily, at bedtime")).toEqual([]);
  });

  it("keeps the dose exactly as written after the name", () => {
    const p = parseMedLine("Metformin 500 mg tablet, 1 tablet twice daily with meals — 8:00 AM, 6:00 PM");
    expect(p?.name).toBe("Metformin");
    expect(p?.dose).toBe("500 mg tablet, 1 tablet twice daily with meals — 8:00 AM, 6:00 PM");
    expect(p?.times).toEqual(["08:00", "18:00"]);
    expect(p?.warnings).toEqual([]);
  });

  it("refuses to guess vague or AM/PM-less times and says so", () => {
    const vague = parseMedLine("Warfarin 5 mg every evening");
    expect(vague?.times).toEqual([]);
    expect(vague?.warnings.join(" ")).toMatch(/evening/);
    const bare = parseMedLine("Sertraline 50 mg at 8");
    expect(bare?.times).toEqual([]);
    expect(bare?.warnings.join(" ")).toMatch(/no AM or PM/);
  });

  it("skips blank lines and bullets", () => {
    const list = parsePastedList("\n- Lisinopril 10 mg daily 8am\n\n2) Spironolactone 25 mg 08:00\n   \n");
    expect(list.map((l) => [l.name, l.times])).toEqual([
      ["Lisinopril", ["08:00"]],
      ["Spironolactone", ["08:00"]],
    ]);
  });

  it("formats times for people", () => {
    expect(formatTime("00:05")).toBe("12:05 AM");
    expect(formatTime("12:00")).toBe("12:00 PM");
    expect(formatTime("18:30")).toBe("6:30 PM");
  });
});
