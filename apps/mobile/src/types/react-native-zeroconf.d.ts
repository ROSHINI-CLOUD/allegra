declare module 'react-native-zeroconf' {
  export const ImplType: {
    NSD: 'NSD';
    DNSSD: 'DNSSD';
  };

  export default class Zeroconf {
    constructor();
    on(event: string, listener: (...args: any[]) => void): this;
    publishService(
      type: string,
      protocol: string,
      domain: string | undefined,
      name: string,
      port: number,
      txt?: Record<string, string>,
      implType?: (typeof ImplType)[keyof typeof ImplType]
    ): void;
    unpublishService(
      name: string,
      implType?: (typeof ImplType)[keyof typeof ImplType]
    ): void;
    removeDeviceListeners(): void;
  }
}
