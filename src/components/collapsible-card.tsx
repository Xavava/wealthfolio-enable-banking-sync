import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@wealthfolio/ui';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCardOpen, type CardOpenOptions, type CardId } from '../hooks/use-card-open';

/**
 * A card that folds from its title. Folded, it shows only the title, a badge and
 * a one-line summary; `actions` (e.g. "Sync now") stay visible either way.
 */
export function CollapsibleCard({
  id,
  title,
  icon,
  badge,
  summary,
  description,
  actions,
  contentClassName,
  children,
  ...openOptions
}: CardOpenOptions & {
  id: CardId;
  title: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  summary?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  contentClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useCardOpen(id, openOptions);

  return (
    <Card>
      <Collapsible open={open} onOpenChange={(next: boolean) => setOpen(next)}>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CollapsibleTrigger className="flex min-w-0 flex-wrap items-center gap-2 text-start">
              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              {icon}
              <CardTitle className="text-base">{title}</CardTitle>
              {badge}
              {!open && summary && <span className="text-muted-foreground text-sm">{summary}</span>}
            </CollapsibleTrigger>
            {actions}
          </div>
          {open && description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CollapsibleContent>
          <CardContent className={contentClassName}>{children}</CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
