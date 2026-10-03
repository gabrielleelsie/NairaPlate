import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ClipboardCheck, Download, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { MODULES, UAT_CASES, type DrillMetrics, type StepResult, type StepStatus } from "@/lib/uat-data";

export const Route = createFileRoute("/uat")({
  head: () => ({
    meta: [
      { title: "UAT Execution Script — Demo Kitchen Owner | NairaPlate" },
      { name: "description", content: "Interactive acceptance test runner for the NairaPlate Demo Kitchen Owner, with Word export." },
      { property: "og:title", content: "UAT Execution Script — Demo Kitchen Owner | NairaPlate" },
      { property: "og:description", content: "Run and record NairaPlate owner acceptance tests and export the protocol as a Word document." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: UatPage,
});

const STATUS_LABEL: Record<StepStatus, string> = { untested: "Untested", pass: "Pass", fail: "Fail", blocked: "Blocked" };
const STATUS_CLASS: Record<StepStatus, string> = {
  pass: "bg-primary text-primary-foreground",
  fail: "bg-destructive text-destructive-foreground",
  blocked: "bg-accent text-accent-foreground",
  untested: "bg-muted text-muted-foreground",
};

function tally(list: StepResult[]) {
  const c: Record<StepStatus, number> = { pass: 0, fail: 0, blocked: 0, untested: 0 };
  list.forEach((s) => c[s.status]++);
  return c;
}

function summaryOf(list: StepResult[]): StepStatus {
  const c = tally(list);
  if (c.fail) return "fail";
  if (c.blocked) return "blocked";
  if (c.pass === list.length) return "pass";
  return "untested";
}

function UatPage() {
  const [tester, setTester] = useState("");
  const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" }));
  const [filter, setFilter] = useState<"all" | "A" | "B" | "C">("all");
  const [exporting, setExporting] = useState(false);
  const [drill, setDrill] = useState<DrillMetrics>({ rpo: "", rto: "", queryResults: "" });
  const [results, setResults] = useState<Record<string, StepResult[]>>(() =>
    Object.fromEntries(UAT_CASES.map((c) => [c.id, c.steps.map(() => ({ actual: "", status: "untested" as StepStatus }))])),
  );

  const all = useMemo(() => Object.values(results).flat(), [results]);
  const counts = tally(all);
  const total = all.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  const update = (id: string, i: number, patch: Partial<StepResult>) =>
    setResults((r) => ({ ...r, [id]: (r[id] ?? []).map((s, j) => (j === i ? { ...s, ...patch } : s)) }));

  async function onExport() {
    setExporting(true);
    try {
      const { exportUatDocx } = await import("@/lib/uat-docx-export");
      await exportUatDocx({ tester, date, results, drill, counts, total });
      toast.success("UAT protocol downloaded");
    } catch (e) {
      toast.error("Export failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExporting(false);
    }
  }

  const visible = UAT_CASES.filter((c) => filter === "all" || c.module === filter);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <ClipboardCheck className="mt-1 h-7 w-7 text-primary" />
              <div>
                <CardTitle className="text-2xl">NairaPlate - User Acceptance Testing (UAT) Execution Script: Demo Kitchen Owner</CardTitle>
                <CardDescription>Persona: Kitchen Owner / Business Operator</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Environment</Label>
                <Input value="Staging / Demo Kitchen" readOnly />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tester">Executed By</Label>
                <Input id="tester" placeholder="Tester name" value={tester} onChange={(e) => setTester(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="date">Date</Label>
                <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Overall Status:</span>
                <Badge className={STATUS_CLASS.pass}>{pct(counts.pass)}% Passed</Badge>
                <Badge className={STATUS_CLASS.fail}>{pct(counts.fail)}% Failed</Badge>
                <Badge className={STATUS_CLASS.blocked}>{pct(counts.blocked)}% Blocked</Badge>
                <Badge className={STATUS_CLASS.untested}>{pct(counts.untested)}% Pending</Badge>
                <span className="text-xs text-muted-foreground">{total - counts.untested} of {total} steps executed</span>
              </div>
              <Progress value={pct(total - counts.untested)} />
            </div>
            <Button size="lg" onClick={onExport} disabled={exporting}>
              {exporting ? <Loader2 className="animate-spin" /> : <Download />}
              Export UAT Protocol as Word Doc (.docx)
            </Button>
          </CardContent>
        </Card>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="all">All modules</TabsTrigger>
            <TabsTrigger value="A">A · Operations</TabsTrigger>
            <TabsTrigger value="B">B · Costing</TabsTrigger>
            <TabsTrigger value="C">C · Disaster recovery</TabsTrigger>
          </TabsList>
        </Tabs>

        {visible.map((tc) => {
          const res = results[tc.id] ?? [];
          const sum = summaryOf(res);
          const c = tally(res);
          return (
            <Card key={tc.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">{tc.id} | {tc.title}</CardTitle>
                    <CardDescription>Module {tc.module}: {MODULES[tc.module]} · {tc.area}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{c.pass}/{res.length} passed</span>
                    <Badge className={STATUS_CLASS[sum]}>{sum === "untested" ? "In progress / Pending" : STATUS_LABEL[sum]}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-md border bg-muted/40 p-3 text-sm">
                  <p className="mb-1 font-medium">Pre-conditions & Setup</p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {tc.preconditions.map((p) => <li key={p}>{p}</li>)}
                  </ul>
                </div>
                {tc.module === "C" && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                    <ShieldAlert className="mt-0.5 h-4 w-4 text-destructive" />
                    <span>Critical drill — only restore into a scratch project, never over the live database.</span>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead className="min-w-48">Action / Instruction</TableHead>
                        <TableHead className="min-w-48">Expected Result</TableHead>
                        <TableHead className="min-w-56">Actual Result</TableHead>
                        <TableHead className="w-36">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tc.steps.map((s, i) => (
                        <TableRow key={i} className="align-top">
                          <TableCell className="font-medium">{i + 1}</TableCell>
                          <TableCell className="whitespace-normal">{s.action}</TableCell>
                          <TableCell className="whitespace-normal text-muted-foreground">{s.expected}</TableCell>
                          <TableCell>
                            <Textarea rows={2} placeholder="What happened?" value={res[i]?.actual ?? ""}
                              onChange={(e) => update(tc.id, i, { actual: e.target.value })} />
                          </TableCell>
                          <TableCell>
                            <Select value={res[i]?.status ?? "untested"} onValueChange={(v) => update(tc.id, i, { status: v as StepStatus })}>
                              <SelectTrigger aria-label={`Status step ${i + 1}`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {(Object.keys(STATUS_LABEL) as StepStatus[]).map((k) => (
                                  <SelectItem key={k} value={k}>{STATUS_LABEL[k]}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {tc.id === "UAT-OWN-06" && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="rpo">Recovery Point (data-loss window)</Label>
                      <Input id="rpo" placeholder="e.g. 4 minutes" value={drill.rpo} onChange={(e) => setDrill({ ...drill, rpo: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="rto">Recovery Time (minutes to restore)</Label>
                      <Input id="rto" placeholder="e.g. 22 minutes" value={drill.rto} onChange={(e) => setDrill({ ...drill, rto: e.target.value })} />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label htmlFor="qr">Query results (row counts, health check output)</Label>
                      <Textarea id="qr" rows={4} placeholder="orders: 1,204 / live 1,204 …" value={drill.queryResults}
                        onChange={(e) => setDrill({ ...drill, queryResults: e.target.value })} />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
