import {JobUnavailable} from '@/components/jobs/job-unavailable';

// What `notFound()` renders for the Job page: the one page every unavailable Job gets.
export default function JobNotFound() {
  return <JobUnavailable/>;
}
