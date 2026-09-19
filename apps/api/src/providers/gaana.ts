import {
  SaavnProvider,
  type ProviderResult,
  type SaavnProviderOptions,
  type SaavnSong
} from './saavn.js';

export class GaanaProvider {
  private readonly provider: SaavnProvider;

  public constructor(options: SaavnProviderOptions) {
    this.provider = new SaavnProvider(options);
  }

  public search(query: string, limit = 20, page = 0): Promise<ProviderResult<SaavnSong[]>> {
    return this.provider.search(query, limit, page);
  }

  public getSong(id: string): Promise<ProviderResult<SaavnSong | null>> {
    return this.provider.getSong(id);
  }

  public getSuggestions(id: string, limit = 10): Promise<ProviderResult<SaavnSong[]>> {
    return this.provider.getSuggestions(id, limit);
  }
}
