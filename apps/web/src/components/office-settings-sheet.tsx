import {
  HISTORY_PAGE_SIZE_OPTIONS,
  LIVE_ROSTER_LIMIT_OPTIONS,
  OFFICE_UI_SETTINGS_STORAGE_KEY,
  type OfficeUiSettings,
} from "../lib/office-settings";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Separator } from "./ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";
import { Switch } from "./ui/switch";

function SettingsIcon() {
  return (
    <svg aria-hidden="true" height="16" viewBox="0 0 20 20" width="16">
      <path
        d="M10 3.2 11.3 4l1.5-.3 1 1.1-.5 1.4.8 1.2 1.5.2.3 1.5-1.2.9v1.5l1.2.9-.3 1.5-1.5.2-.8 1.2.5 1.4-1 1.1-1.5-.3-1.3.8-1.3-.8-1.5.3-1-1.1.5-1.4-.8-1.2-1.5-.2-.3-1.5 1.2-.9v-1.5l-1.2-.9.3-1.5 1.5-.2.8-1.2-.5-1.4 1-1.1 1.5.3L10 3.2Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
      <circle cx="10" cy="10" fill="none" r="2.8" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

interface OfficeSettingsSheetProps {
  onReset(): void;
  onSettingsChange(patch: Partial<OfficeUiSettings>): void;
  open: boolean;
  onOpenChange(open: boolean): void;
  settings: OfficeUiSettings;
}

export function OfficeSettingsSheet(props: OfficeSettingsSheetProps) {
  return (
    <Sheet onOpenChange={props.onOpenChange} open={props.open}>
      <SheetTrigger asChild>
        <Button aria-label="Open settings" size="sm" type="button" variant="ghost">
          <SettingsIcon />
          <span>Settings</span>
        </Button>
      </SheetTrigger>

      <SheetContent>
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>
            Browser-local preferences for the dashboard chrome and office view.
          </SheetDescription>
        </SheetHeader>

        <Card className="grid gap-4 p-4">
          <div className="grid gap-1">
            <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-[#6f6258]">
              Behavior
            </h3>
            <p className="text-sm text-[#6f6258]">
              Control how much history and live activity the dashboard surfaces by default.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="grid gap-1">
              <Label htmlFor="show-offline-history-default">Show offline history by default</Label>
              <p className="text-sm text-[#6f6258]">
                Open the offline roster section automatically on page load.
              </p>
            </div>
            <Switch
              checked={props.settings.showOfflineHistoryByDefault}
              id="show-offline-history-default"
              onCheckedChange={(checked) =>
                props.onSettingsChange({
                  showOfflineHistoryByDefault: checked,
                })
              }
            />
          </div>

          <Separator />

          <div className="grid gap-2">
            <Label htmlFor="live-roster-limit">Live roster limit</Label>
            <Select
              onValueChange={(value) =>
                props.onSettingsChange({
                  liveRosterLimit: Number(value) as OfficeUiSettings["liveRosterLimit"],
                })
              }
              value={String(props.settings.liveRosterLimit)}
            >
              <SelectTrigger aria-label="Live roster limit" id="live-roster-limit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIVE_ROSTER_LIMIT_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option} live cards
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="history-page-size">Offline history page size</Label>
            <Select
              onValueChange={(value) =>
                props.onSettingsChange({
                  historyPageSize: Number(value) as OfficeUiSettings["historyPageSize"],
                })
              }
              value={String(props.settings.historyPageSize)}
            >
              <SelectTrigger aria-label="Offline history page size" id="history-page-size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HISTORY_PAGE_SIZE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option} history cards
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Card>

        <Card className="grid gap-4 p-4">
          <div className="grid gap-1">
            <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-[#6f6258]">
              Visuals
            </h3>
            <p className="text-sm text-[#6f6258]">
              Keep the office readable without introducing a full theme system yet.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="grid gap-1">
              <Label htmlFor="reduced-motion">Reduced motion</Label>
              <p className="text-sm text-[#6f6258]">
                Soften canvas movement and remove UI transitions where possible.
              </p>
            </div>
            <Switch
              checked={props.settings.reducedMotion}
              id="reduced-motion"
              onCheckedChange={(checked) =>
                props.onSettingsChange({
                  reducedMotion: checked,
                })
              }
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-4">
            <div className="grid gap-1">
              <Label htmlFor="show-office-tooltips">Show office tooltips</Label>
              <p className="text-sm text-[#6f6258]">
                Enable hover tooltips above agents in the office scene.
              </p>
            </div>
            <Switch
              checked={props.settings.showOfficeTooltips}
              id="show-office-tooltips"
              onCheckedChange={(checked) =>
                props.onSettingsChange({
                  showOfficeTooltips: checked,
                })
              }
            />
          </div>
        </Card>

        <SheetFooter>
          <Button onClick={props.onReset} type="button" variant="secondary">
            Reset to defaults
          </Button>
          <p className="text-xs text-[#6f6258]">
            Stored locally in <code>{OFFICE_UI_SETTINGS_STORAGE_KEY}</code>.
          </p>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
