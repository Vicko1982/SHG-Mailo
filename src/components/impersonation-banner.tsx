import { Eye, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useImpersonation } from "@/lib/impersonation";
import { useLanguage } from "@/lib/language";

export function ImpersonationBanner() {
  const { isImpersonating, impersonatedName, stopImpersonation } = useImpersonation();
  const { tr } = useLanguage();
  if (!isImpersonating) return null;
  return (
    <div className="sticky top-0 z-30 bg-amber-500 text-amber-950 border-b border-amber-700 px-3 py-1.5 flex items-center gap-2 text-sm">
      <Eye className="h-4 w-4" />
      <span>
        {tr("Viewing as", "Προβολή ως")} <strong>{impersonatedName}</strong> ({tr("read-only", "μόνο για ανάγνωση")})
      </span>
      <Button
        size="sm"
        variant="outline"
        className="ml-auto h-7 bg-white/20 border-amber-800 hover:bg-white/40 text-amber-950"
        onClick={() => stopImpersonation()}
      >
        <LogOut className="h-3.5 w-3.5 mr-1" /> {tr("Exit", "Έξοδος")}
      </Button>
    </div>
  );
}
