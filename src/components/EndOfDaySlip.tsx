import type { Slip } from "@/lib/end-of-day";

/**
 * The end-of-day slip, laid out for A4. It is on the page for printing only (`hidden print:block`), so a person sees the
 * normal screen and gets the slip when they press Print. Every label and value comes from buildSlip(): nothing is worked out here.
 */
export function EndOfDaySlip({ slip }: { slip: Slip }) {
  return (
    <section
      className="hidden print:block text-black"
      aria-label="End-of-day slip"
      data-testid="end-of-day-slip"
    >
      <style>{"@media print { @page { size: A4; margin: 15mm; } }"}</style>
      <p className="text-sm font-bold tracking-wide">NairaPlate</p>
      <h1 className="mt-1 text-2xl font-bold">{slip.title}</h1>
      <p className="text-lg font-semibold">{slip.businessName}</p>
      <p className="text-sm">{slip.dateLine}</p>
      {slip.warning && (
        <p className="mt-3 border border-black p-2 text-sm font-bold">{slip.warning}</p>
      )}
      {slip.sections.map((section) => (
        <div key={section.title} className="mt-5 break-inside-avoid">
          <h2 className="border-b border-black pb-1 text-sm font-bold tracking-wide">
            {section.title}
          </h2>
          {section.groups.map((group, gi) => (
            <div key={gi} className="mt-2">
              {group.heading && <p className="text-sm font-semibold">{group.heading}</p>}
              <table className="w-full text-sm">
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.label} className={row.bold ? "font-bold" : ""}>
                      <td className={`py-0.5 pr-3 ${row.indent ? "pl-4" : ""}`}>{row.label}</td>
                      <td className="py-0.5 text-right whitespace-nowrap">
                        {row.value}
                        {row.note ? <span className="font-normal"> {row.note}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ))}
      <p className="mt-6 text-xs">{slip.footer}</p>
      <p className="mt-6 text-sm">{slip.checkedBy}</p>
    </section>
  );
}
