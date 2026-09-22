"use client";

import { Target } from "lucide-react";
import { KitPicker } from "@/components/kit/kit-picker";

export default function PracticeHubPage() {
  return <KitPicker title="Practice" description="Pick a kit. Sessions prioritise your weakest, highest-stakes material." suffix="practice" icon={<Target />} cta="Practise" />;
}
