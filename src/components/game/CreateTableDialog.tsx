import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useUiBlock } from "@/lib/uiFocus";

const DURATIONS = [15, 25, 50, 90, 120];

export type NewTableInput = {
  name: string;
  subject: string;
  goal: string;
  duration: number;
};

export function CreateTableDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (input: NewTableInput) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [goal, setGoal] = useState("");
  const [duration, setDuration] = useState(50);
  const [submitting, setSubmitting] = useState(false);

  // Block the game world from receiving input while the dialog is mounted+open.
  useUiBlock(open);



  const reset = () => {
    setName(""); setSubject(""); setGoal(""); setDuration(50); setSubmitting(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !subject.trim()) return;
    setSubmitting(true);
    try {
      await onCreate({
        name: name.trim().slice(0, 60),
        subject: subject.trim().slice(0, 60),
        goal: goal.trim().slice(0, 200),
        duration,
      });
      reset();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md border-white/15 bg-black/85 text-white backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle>Create a study table</DialogTitle>
          <DialogDescription className="text-white/50">
            Define what you're working on. Others can join your table.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="t-name" className="text-xs uppercase tracking-wider text-white/60">Table name</Label>
            <Input id="t-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Machine Learning Sprint" maxLength={60} className="bg-white/5 border-white/15" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-subject" className="text-xs uppercase tracking-wider text-white/60">Subject</Label>
            <Input id="t-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Deep Learning" maxLength={60} className="bg-white/5 border-white/15" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-goal" className="text-xs uppercase tracking-wider text-white/60">Study goal <span className="text-white/30">(optional)</span></Label>
            <Textarea id="t-goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What you want to finish in this session" maxLength={200} rows={2} className="bg-white/5 border-white/15 resize-none" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-white/60">Session duration</Label>
            <div className="flex flex-wrap gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDuration(d)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    duration === d
                      ? "bg-amber-400/20 ring-1 ring-amber-400/60 text-amber-300"
                      : "bg-white/5 text-white/60 hover:bg-white/10"
                  }`}
                >
                  {d >= 60 ? `${(d / 60).toFixed(d % 60 ? 1 : 0)}h` : `${d}m`}
                </button>
              ))}
            </div>
          </div>
          <Button type="submit" disabled={submitting || !name.trim() || !subject.trim()} className="w-full bg-gradient-to-r from-amber-500 to-orange-500 text-white">
            {submitting ? "Creating…" : "Create table"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}