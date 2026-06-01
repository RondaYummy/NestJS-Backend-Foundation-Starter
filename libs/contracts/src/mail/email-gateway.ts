export interface IEmailGateway {
  send(input: {
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    from?: string;
  }): Promise<void>;
}
