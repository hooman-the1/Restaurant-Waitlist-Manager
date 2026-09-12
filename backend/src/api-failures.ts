import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';

export const INVALID_REQUEST_MESSAGE = 'Invalid request.';
export const DUPLICATE_PHONE_MESSAGE =
  'This phone number is already on the waitlist.';
export const UNEXPECTED_FAILURE_MESSAGE =
  'Something went wrong. Please try again.';

type ApiFailureCode =
  | 'validation'
  | 'signup-conflict'
  | 'duplicate-phone'
  | 'unauthorized'
  | 'not-found'
  | 'invalid-or-used-token'
  | 'unexpected';

class ApiFailure extends Error {
  constructor(
    readonly code: ApiFailureCode,
    message = '',
  ) {
    super(message);
  }
}

export function validationFailure(message: string): ApiFailure {
  return new ApiFailure('validation', requireSafeMessage(message));
}

export function signupConflictFailure(message: string): ApiFailure {
  return new ApiFailure('signup-conflict', requireSafeMessage(message));
}

export function duplicatePhoneFailure(): ApiFailure {
  return new ApiFailure('duplicate-phone');
}

export function unauthorizedFailure(): ApiFailure {
  return new ApiFailure('unauthorized');
}

export function notFoundFailure(): ApiFailure {
  return new ApiFailure('not-found');
}

export function invalidOrUsedTokenFailure(): ApiFailure {
  return new ApiFailure('invalid-or-used-token');
}

export function unexpectedFailure(): ApiFailure {
  return new ApiFailure('unexpected');
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const failure = mapFailure(exception);

    response.status(failure.status).json(failure.body);
  }
}

interface MappedFailure {
  status: number;
  body:
    | { kind: 'validation'; message: string }
    | { kind: 'duplicate-phone'; message: typeof DUPLICATE_PHONE_MESSAGE }
    | { kind: 'unauthorized' }
    | { kind: 'not-found' }
    | { kind: 'invalid-or-used-token' }
    | { kind: 'unexpected'; message: typeof UNEXPECTED_FAILURE_MESSAGE };
}

function mapFailure(exception: unknown): MappedFailure {
  if (exception instanceof ApiFailure) {
    return mapTypedFailure(exception);
  }
  if (exception instanceof BadRequestException) {
    return {
      status: HttpStatus.BAD_REQUEST,
      body: { kind: 'validation', message: INVALID_REQUEST_MESSAGE },
    };
  }
  if (exception instanceof NotFoundException) {
    return { status: HttpStatus.NOT_FOUND, body: { kind: 'not-found' } };
  }

  return unexpectedMapping();
}

function mapTypedFailure(failure: ApiFailure): MappedFailure {
  switch (failure.code) {
    case 'validation':
      return {
        status: HttpStatus.BAD_REQUEST,
        body: { kind: 'validation', message: failure.message },
      };
    case 'signup-conflict':
      return {
        status: HttpStatus.CONFLICT,
        body: { kind: 'validation', message: failure.message },
      };
    case 'duplicate-phone':
      return {
        status: HttpStatus.CONFLICT,
        body: { kind: 'duplicate-phone', message: DUPLICATE_PHONE_MESSAGE },
      };
    case 'unauthorized':
      return {
        status: HttpStatus.UNAUTHORIZED,
        body: { kind: 'unauthorized' },
      };
    case 'not-found':
      return { status: HttpStatus.NOT_FOUND, body: { kind: 'not-found' } };
    case 'invalid-or-used-token':
      return {
        status: HttpStatus.BAD_REQUEST,
        body: { kind: 'invalid-or-used-token' },
      };
    case 'unexpected':
      return unexpectedMapping();
  }
}

function unexpectedMapping(): MappedFailure {
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: { kind: 'unexpected', message: UNEXPECTED_FAILURE_MESSAGE },
  };
}

function requireSafeMessage(message: string): string {
  if (message.trim().length === 0) {
    throw new Error('A non-empty client-safe message is required.');
  }

  return message;
}
