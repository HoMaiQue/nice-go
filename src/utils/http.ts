'use client';

import { enqueueSnackbar } from 'notistack';
import axios, { AxiosError, AxiosInstance } from 'axios';

import { ENDPOINTS } from 'src/constants/endpoints';
import HttpStatusCode from 'src/constants/httpStatusCode';

import { LoginResponse } from 'src/types/auth';
import { ErrorResponse, SuccessResponse } from 'src/types/utils';

import { isAxiosExpiredTokenError, isAxiosUnauthorizedError } from './helpers';
import {
  clearLS,
  setUserIdToLS,
  getUserIdFromLS,
  setAccessTokenToLS,
  setRefreshTokenToLS,
  getAccessTokenFromLS,
  getRefreshTokenFromLS,
} from './auth';

class Http {
  axiosInstance: AxiosInstance;

  accessToken: string;

  refreshToken: string;

  refreshTokenRequest: Promise<string> | null;

  user_id: string;

  constructor(isChangeUrl?: boolean) {
    this.accessToken = getAccessTokenFromLS();
    this.refreshToken = getRefreshTokenFromLS();
    this.refreshTokenRequest = null;
    this.user_id = getUserIdFromLS();
    this.axiosInstance = axios.create({
      baseURL: !isChangeUrl
        ? process.env.NEXT_PUBLIC_API_ENDPOINT_MAIN
        : process.env.NEXT_PUBLIC_API_ENDPOINT_COIN,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add a request interceptor
    this.axiosInstance.interceptors.request.use(
      (config) => {
        if (this.accessToken && config.headers) {
          config.headers.authorization = `Bearer ${this.accessToken}`;
          config.headers['x-client-id'] = this.user_id;
          return config;
        }
        return config;
      },
      (error) =>
        // Do something with request error
        Promise.reject(error)
    );

    // Add a response interceptor
    this.axiosInstance.interceptors.response.use(
      (response) => {
        const { url } = response.config;

        if (url === ENDPOINTS.auth.login) {
          const data = response.data as SuccessResponse<LoginResponse>;
          this.accessToken = data.metaData.tokens.access_token;
          this.refreshToken = data.metaData.tokens.refresh_token;
          this.user_id = data.metaData.user_id;
          setAccessTokenToLS(this.accessToken);
          setRefreshTokenToLS(this.refreshToken);
          setUserIdToLS(this.user_id);
        } else if (url === ENDPOINTS.auth.logout) {
          this.accessToken = '';
          this.refreshToken = '';
          clearLS();
        }
        return response;
      },
      (error: AxiosError) => {
        if (
          ![HttpStatusCode.UnprocessableEntity, HttpStatusCode.Unauthorized].includes(
            error.response?.status as number
          )
        ) {
          const data: any | undefined = error.response?.data;
          const message = data?.message || error.message;
          enqueueSnackbar(message);
        }

        if (isAxiosUnauthorizedError<ErrorResponse<null>>(error)) {
          const config = error.response?.config as any;
          const { url } = config as any;
          if (isAxiosExpiredTokenError(error) && url !== ENDPOINTS.auth.refreshToken) {
            this.refreshTokenRequest = this.refreshTokenRequest
              ? this.refreshTokenRequest
              : this.handleRefreshToken().finally(() => {
                  setTimeout(() => {
                    this.refreshTokenRequest = null;
                  }, 10000);
                });
            return this.refreshTokenRequest.then((access_token) =>
              this.axiosInstance({
                ...config,
                headers: {
                  ...config.headers,
                  authorization: access_token,
                },
              })
            );
          }

          clearLS();
          this.accessToken = '';
          this.refreshToken = '';
          enqueueSnackbar(error.config?.data.message || error.message);
        }
        return Promise.reject(error);
      }
    );
  }

  private handleRefreshToken() {
    return this.axiosInstance
      .post<SuccessResponse<LoginResponse>>(
        ENDPOINTS.auth.refreshToken,
        {},
        { headers: { 'x-rtoken-id': this.refreshToken } }
      )
      .then((res) => {
        const data = res.data as SuccessResponse<LoginResponse>;
        const { access_token } = data.metaData.tokens;
        this.accessToken = data.metaData.tokens.access_token;
        this.refreshToken = data.metaData.tokens.refresh_token;
        setAccessTokenToLS(this.accessToken);
        setRefreshTokenToLS(this.refreshToken);

        return access_token;
      })
      .catch((error) => {
        clearLS();
        this.accessToken = '';
        this.refreshToken = '';
        throw error;
      });
  }
}
const http = new Http().axiosInstance;
export const httpCoin = new Http(true).axiosInstance;
export default http;
