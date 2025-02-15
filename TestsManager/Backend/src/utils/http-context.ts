export class HttpContext {
    public protocol: string;
    public host: string;
    public port: number;

    constructor(protocol: string, host: string, port: number) {
        this.protocol = protocol;
        this.host = host;
        this.port = port;
    }
}