import { assessmentModeLabel } from '@/lib/assessment';
import { Badge } from './ui/Badge';

export default function AssessmentModeBadge({mode}:{mode?:string}){
  const value=mode==='WHITE_BOX'?'WHITE_BOX':'BLACK_BOX';
  return <Badge tone={value==='WHITE_BOX'?'info':'neutral'}>{assessmentModeLabel(value)}</Badge>;
}
