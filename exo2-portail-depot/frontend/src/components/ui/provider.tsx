import { ChakraProvider } from '@chakra-ui/react';
import type { PropsWithChildren } from 'react';
import { system } from '../../theme';

/**
 * Light only : pas de ColorModeProvider (next-themes), pas de bascule de
 * theme. C'est une exigence de la charte, pas une simplification.
 */
export function Provider({ children }: PropsWithChildren) {
  return <ChakraProvider value={system}>{children}</ChakraProvider>;
}
