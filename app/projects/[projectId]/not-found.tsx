import {ProjectUnavailable} from '@/components/projects/unavailable';

// What `notFound()` renders for the Project pages (the overview and Sources): the one page every unavailable Project gets.
export default function ProjectNotFound() {
  return <ProjectUnavailable/>;
}
