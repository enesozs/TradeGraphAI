import { useMemo } from "react";
import { Combobox, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxPopup } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import type { BuildInfo } from "@/lib/meta";

export function BasketSelect({ info, value, onChange, label = "Product basket", className = "w-64" }: {
  info: BuildInfo | null; value: string; onChange: (v: string) => void; label?: string; className?: string;
}) {
  const items = (info?.baskets ?? []).map((b) => ({ value: b.id, label: b.label }));
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Select items={items} value={value} onValueChange={(v) => v && onChange(v as string)}>
        <SelectTrigger className={className}><SelectValue /></SelectTrigger>
        <SelectPopup>{items.map((it) => <SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>)}</SelectPopup>
      </Select>
    </div>
  );
}

export function YearSlider({ info, value, onChange, className = "w-56", disabled }: {
  info: BuildInfo | null; value: number | null; onChange: (y: number) => void; className?: string; disabled?: boolean;
}) {
  if (!info || value == null) return null;
  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex justify-between text-sm"><Label>Year</Label><span className="text-foreground">{value}{info.provisional_years.includes(value) ? ", provisional" : ""}</span></div>
      <Slider aria-label="Year" disabled={disabled} min={info.years[0]} max={info.years.at(-1)} step={1} value={value} onValueChange={(v) => onChange(v as number)} />
    </div>
  );
}

type Opt = { value: string; label: string };
// Searchable country picker. `options` = iso3 codes to offer (e.g. importers present in the data); names from geo.
export function CountryPicker({ options, names, value, onChange, label = "Country", className = "w-64" }: {
  options: string[]; names: Map<string, string> | undefined; value: string; onChange: (iso3: string) => void; label?: string; className?: string;
}) {
  const items = useMemo<Opt[]>(
    () => options.map((o) => ({ value: o, label: names?.get(o) ?? o })).sort((a, b) => a.label.localeCompare(b.label)),
    [options, names],
  );
  const selected = items.find((i) => i.value === value) ?? null;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Label>{label}</Label>
      <Combobox<Opt> items={items} value={selected} onValueChange={(v) => v && onChange(v.value)} itemToStringLabel={(i) => i.label} isItemEqualToValue={(a, b) => a.value === b.value}>
        <ComboboxInput placeholder="Search a country" aria-label={label} />
        <ComboboxPopup>
          <ComboboxEmpty>No country found.</ComboboxEmpty>
          <ComboboxList>{(item: Opt) => <ComboboxItem key={item.value} value={item}>{item.label}</ComboboxItem>}</ComboboxList>
        </ComboboxPopup>
      </Combobox>
    </div>
  );
}
