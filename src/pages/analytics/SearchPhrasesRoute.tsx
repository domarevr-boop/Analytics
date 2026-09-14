import { isV5SearchQueriesBackendEnabled } from '../../features/searchQueries/searchQueriesData';
import { SearchPhrasesLocalPage } from './SearchPhrasesPage';
import SearchPhrasesServerPage from './SearchPhrasesServerPage';

export default function SearchPhrasesRoute() {
  return isV5SearchQueriesBackendEnabled ? <SearchPhrasesServerPage /> : <SearchPhrasesLocalPage />;
}
