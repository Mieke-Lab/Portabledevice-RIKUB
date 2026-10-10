import { Drone } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DroneFloatingButton({ active, onClick }) {
  return (
    <Button
      size="icon"
      variant="outline"
      className={`absolute right-4 top-[248px] z-[1000] h-12 w-12 rounded-[16px] border-0 bg-white text-forest shadow-[0_8px_30px_rgba(0,0,0,0.12)] hover:bg-gray-50 sm:top-[180px] ${
        active ? "ring-2 ring-leaf/30" : ""
      }`}
      onClick={onClick}
      title="Drone Dashboard"
    >
      <Drone className="h-5 w-5" />
    </Button>
  );
}
